/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import {
  Product,
  Warehouse,
  StockLevel,
  Reservation,
  ProductWithStock,
  StockInfo,
  ReservationStatus
} from '../src/types';

// Let's define the DB JSON schema
interface AppDatabase {
  products: Product[];
  warehouses: Warehouse[];
  stockLevels: StockLevel[];
  reservations: Reservation[];
  idempotencyKeys: Record<string, { status: number; result: any }>;
}

// In-memory TS DB that optionally persists to disk
const DB_FILE = path.join(process.cwd(), 'db.json');

// Default Seed Data
const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'p1',
    sku: 'BAG-CL-LTH',
    name: 'Allo Leather Backpack',
    description: 'Handcrafted from full-grain leather. Designed for daily travel with solid brass hardware, padded laptop sleeve, and ergonomic shoulders.',
    price: 189,
    imageUrl: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=600&auto=format&fit=crop&q=60'
  },
  {
    id: 'p2',
    sku: 'BOT-MN-SST',
    name: 'Allo Minimalist Water Flask',
    description: 'Double-walled vacuum insulated surgical steel flask. Keeps beverages ice cold for 24 hours or piping hot for 12 hours.',
    price: 39,
    imageUrl: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600&auto=format&fit=crop&q=60'
  },
  {
    id: 'p3',
    sku: 'CHR-ER-DSK',
    name: 'Allo Ergonomic Desk Chair',
    description: 'Advanced posture-reactive lumbar support, full-range dynamic tilt, and highly breathable engineered mesh. Stay focused and comfortable.',
    price: 499,
    imageUrl: 'https://images.unsplash.com/photo-1505797149-43b0069ec26b?w=600&auto=format&fit=crop&q=60'
  },
  {
    id: 'p4',
    sku: 'KBD-MC-ALU',
    name: 'Allo Mechanical Assembly Keyboard',
    description: 'Aircraft-grade standard aluminum casing, premium hot-swappable tactile switches, and high-density acoustic dampening foam.',
    price: 219,
    imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&auto=format&fit=crop&q=60'
  }
];

const INITIAL_WAREHOUSES: Warehouse[] = [
  { id: 'wh-oak', name: 'Oakland Logistics Unit', location: 'Oakland, CA' },
  { id: 'wh-bkn', name: 'Brooklyn Fulfillment Depot', location: 'Brooklyn, NY' },
  { id: 'wh-atx', name: 'Austin Central Distribution', location: 'Austin, TX' }
];

const INITIAL_STOCK: StockLevel[] = [
  // Leather Backpack
  { productId: 'p1', warehouseId: 'wh-oak', total: 12, reserved: 0 },
  { productId: 'p1', warehouseId: 'wh-bkn', total: 6, reserved: 0 },
  { productId: 'p1', warehouseId: 'wh-atx', total: 1, reserved: 0 }, // Highly scarce! Good for racing!

  // Water Flask
  { productId: 'p2', warehouseId: 'wh-oak', total: 45, reserved: 0 },
  { productId: 'p2', warehouseId: 'wh-bkn', total: 30, reserved: 0 },
  { productId: 'p2', warehouseId: 'wh-atx', total: 15, reserved: 0 },

  // Desk Chair
  { productId: 'p3', warehouseId: 'wh-oak', total: 4, reserved: 0 },
  { productId: 'p3', warehouseId: 'wh-bkn', total: 8, reserved: 0 },
  { productId: 'p3', warehouseId: 'wh-atx', total: 2, reserved: 0 },

  // Keyboard
  { productId: 'p4', warehouseId: 'wh-oak', total: 10, reserved: 0 },
  { productId: 'p4', warehouseId: 'wh-bkn', total: 5, reserved: 0 },
  { productId: 'p4', warehouseId: 'wh-atx', total: 3, reserved: 0 }
];

class KeyedMutex {
  private locks = new Map<string, Promise<any>>();

  async acquire(key: string): Promise<() => void> {
    let resolveLock!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });

    const currentLock = this.locks.get(key);
    this.locks.set(key, nextLock);

    if (currentLock) {
      await currentLock;
    }

    return () => {
      if (this.locks.get(key) === nextLock) {
        this.locks.delete(key);
      }
      resolveLock();
    };
  }
}

class ProductInventoryDb {
  private memoryDb: AppDatabase | null = null;
  private dbMutex = new KeyedMutex();
  private fileLock = new KeyedMutex();

  private async loadDb(): Promise<AppDatabase> {
    // Acquire a lock for the DB file
    const release = await this.fileLock.acquire('db-file');
    try {
      if (this.memoryDb) {
        return this.memoryDb;
      }

      try {
        const fileContent = await fs.readFile(DB_FILE, 'utf-8');
        this.memoryDb = JSON.parse(fileContent);
        console.log('[DB] Loaded existing data representation from disk.');
      } catch (err) {
        // Create initial database JSON file if missing
        console.log('[DB] Database file not found. Seeding initial Allo inventory database...');
        const initialData: AppDatabase = {
          products: INITIAL_PRODUCTS,
          warehouses: INITIAL_WAREHOUSES,
          stockLevels: INITIAL_STOCK,
          reservations: [],
          idempotencyKeys: {}
        };
        await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
        await fs.writeFile(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
        this.memoryDb = initialData;
      }
      return this.memoryDb;
    } finally {
      release();
    }
  }

  private async saveDb(): Promise<void> {
    const release = await this.fileLock.acquire('db-file');
    try {
      if (this.memoryDb) {
        await fs.writeFile(DB_FILE, JSON.stringify(this.memoryDb, null, 2), 'utf-8');
      }
    } finally {
      release();
    }
  }

  // Expiry check logic (Lazy cleanup + interval sweep)
  // Sweeps all expired 'pending' reservations and releases their stock back to the pool
  public async cleanupExpiredReservations(): Promise<number> {
    const db = await this.loadDb();
    const now = new Date();
    let releaseCount = 0;

    // Filter pending reservations that have expired
    const expiredReservations = db.reservations.filter(
      r => r.status === 'pending' && new Date(r.expiresAt) < now
    );

    if (expiredReservations.length === 0) {
      return 0;
    }

    console.log(`[Expiry Sweep] Found ${expiredReservations.length} expired reservations to release.`);

    for (const r of expiredReservations) {
      // Find stock level mapping
      const stock = db.stockLevels.find(
        s => s.productId === r.productId && s.warehouseId === r.warehouseId
      );

      // Lock this item block to be safe
      const lockKey = `${r.productId}:${r.warehouseId}`;
      const releaseLock = await this.dbMutex.acquire(lockKey);
      try {
        r.status = 'released';
        if (stock) {
          stock.reserved = Math.max(0, stock.reserved - r.units);
          console.log(`[Expiry Sweep] Released ${r.units} units of ${r.sku} in ${r.warehouseId}.`);
        }
        releaseCount++;
      } finally {
        releaseLock();
      }
    }

    if (releaseCount > 0) {
      await this.saveDb();
    }

    return releaseCount;
  }

  // 1. Reset/Seed Database Endpoint Helper (For manual UI reset)
  public async resetDatabase(): Promise<void> {
    this.memoryDb = {
      products: INITIAL_PRODUCTS.map(p => ({ ...p })),
      warehouses: INITIAL_WAREHOUSES.map(w => ({ ...w })),
      stockLevels: INITIAL_STOCK.map(s => ({ ...s, reserved: 0 })),
      reservations: [],
      idempotencyKeys: {}
    };
    await this.saveDb();
    console.log('[DB] Database reset successfully completed.');
  }

  // 2. List products with available stock
  public async getProducts(): Promise<ProductWithStock[]> {
    // Lazily clean up expired reservations first to ensure real-time accuracy!
    await this.cleanupExpiredReservations();

    const db = await this.loadDb();
    return db.products.map(p => {
      const stocks: StockInfo[] = db.stockLevels
        .filter(s => s.productId === p.id)
        .map(s => {
          const wh = db.warehouses.find(w => w.id === s.warehouseId)!;
          return {
            warehouseId: s.warehouseId,
            warehouseName: wh.name,
            warehouseLocation: wh.location,
            total: s.total,
            reserved: s.reserved,
            available: Math.max(0, s.total - s.reserved)
          };
        });

      return {
        ...p,
        stocks
      };
    });
  }

  // 3. List warehouses
  public async getWarehouses(): Promise<Warehouse[]> {
    const db = await this.loadDb();
    return db.warehouses;
  }

  // 4. Create reservation with explicit verification under concurrency
  public async createReservation(
    idempotencyKey: string | undefined,
    productId: string,
    warehouseId: string,
    units: number,
    holdDurationSeconds: number = 60 // Configurable hold for easy testing!
  ): Promise<{ status: number; result: any }> {
    const db = await this.loadDb();

    // Check Idempotency Key
    if (idempotencyKey && db.idempotencyKeys[idempotencyKey]) {
      console.log(`[Idempotency] Request duplicate detected for key "${idempotencyKey}". Returning saved response.`);
      return db.idempotencyKeys[idempotencyKey];
    }

    // Ensure valid input
    if (units <= 0) {
      return { status: 400, result: { error: 'Units must be greater than zero.' } };
    }

    // Acquire lock for this specific Stock Slot (Product-Warehouse combo)
    const lockKey = `${productId}:${warehouseId}`;
    const releaseLock = await this.dbMutex.acquire(lockKey);

    try {
      // Refresh DB data state inside lock (makes sure reading latest values)
      // Lazily cleanup inside lock too, to make sure expired holds are cleared BEFORE checking capacity!
      await this.cleanupExpiredReservations();

      const product = db.products.find(p => p.id === productId);
      if (!product) {
        return { status: 404, result: { error: 'Product not found.' } };
      }

      const warehouse = db.warehouses.find(w => w.id === warehouseId);
      if (!warehouse) {
        return { status: 404, result: { error: 'Warehouse not found.' } };
      }

      const stock = db.stockLevels.find(
        s => s.productId === productId && s.warehouseId === warehouseId
      );

      if (!stock) {
        return { status: 404, result: { error: 'Stock mapping not found for this warehouse.' } };
      }

      const available = stock.total - stock.reserved;
      if (available < units) {
        console.warn(`[Conflict] Concurrency blocked reservation of ${units}x SKU ${product.sku} at ${warehouseId}. Current total: ${stock.total}, reserved: ${stock.reserved}, available: ${available}`);
        return {
          status: 409,
          result: {
            error: `Not enough stock available. Requested ${units} units, but only ${available} are available at ${warehouse.name}.`
          }
        };
      }

      // Perform reservation creation safely
      const expiresAt = new Date(Date.now() + holdDurationSeconds * 1000).toISOString();
      const reservation: Reservation = {
        id: crypto.randomUUID(),
        productId,
        warehouseId,
        sku: product.sku,
        units,
        status: 'pending',
        expiresAt,
        createdAt: new Date().toISOString(),
        idempotencyKey
      };

      // Increment reserved stock
      stock.reserved += units;
      db.reservations.push(reservation);

      await this.saveDb();

      console.log(`[Reserved] Successfully reserved ${units}x SKU ${product.sku} at ${warehouseId}. Holds expire at ${expiresAt}`);

      const successResponse = { status: 201, result: reservation };

      // Record Idempotency Key
      if (idempotencyKey) {
        db.idempotencyKeys[idempotencyKey] = successResponse;
        await this.saveDb();
      }

      return successResponse;
    } finally {
      // Crucial: Release the lock
      releaseLock();
    }
  }

  // 5. Confirm Reservation (Payment Successful)
  public async confirmReservation(
    idempotencyKey: string | undefined,
    reservationId: string
  ): Promise<{ status: number; result: any }> {
    const db = await this.loadDb();

    // Check Idempotency Key
    if (idempotencyKey && db.idempotencyKeys[idempotencyKey]) {
      console.log(`[Idempotency] Request duplicate detected for confirm key "${idempotencyKey}".`);
      return db.idempotencyKeys[idempotencyKey];
    }

    const reservation = db.reservations.find(r => r.id === reservationId);
    if (!reservation) {
      return { status: 404, result: { error: 'Reservation not found.' } };
    }

    // Acquire lock for this Stock Slot
    const lockKey = `${reservation.productId}:${reservation.warehouseId}`;
    const releaseLock = await this.dbMutex.acquire(lockKey);

    try {
      const stock = db.stockLevels.find(
        s => s.productId === reservation.productId && s.warehouseId === reservation.warehouseId
      )!;

      // Handle terminal states
      if (reservation.status === 'confirmed') {
        return { status: 200, result: reservation }; // Success (Already confirmed is idempotent)
      }

      if (reservation.status === 'released') {
        return { status: 410, result: { error: 'Reservation has expired and been released.' } };
      }

      // Check current validity of expiration time
      const isExpired = new Date() > new Date(reservation.expiresAt);
      if (isExpired) {
        reservation.status = 'released';
        stock.reserved = Math.max(0, stock.reserved - reservation.units);
        await this.saveDb();
        console.warn(`[Confirm Expired] Reservation ${reservationId} expired. Released holding capacity.`);
        return { status: 410, result: { error: 'Reservation expired. Units returned to available stock.' } };
      }

      // Confirm reservation successfully!
      reservation.status = 'confirmed';

      // Permanently decrement both total and reserved quantities
      stock.total = Math.max(0, stock.total - reservation.units);
      stock.reserved = Math.max(0, stock.reserved - reservation.units);

      await this.saveDb();

      console.dir(`[Confirmed] Reservation ${reservationId} for ${reservation.units}x SKU ${reservation.sku} confirmed.`);

      const successResponse = { status: 200, result: reservation };

      // Safe idempotency
      if (idempotencyKey) {
        db.idempotencyKeys[idempotencyKey] = successResponse;
        await this.saveDb();
      }

      return successResponse;
    } finally {
      releaseLock();
    }
  }

  // 6. Release Reservation Early (User canceled / Payment failed)
  public async releaseReservation(
    reservationId: string
  ): Promise<{ status: number; result: any }> {
    const db = await this.loadDb();
    const reservation = db.reservations.find(r => r.id === reservationId);

    if (!reservation) {
      return { status: 404, result: { error: 'Reservation not found.' } };
    }

    const lockKey = `${reservation.productId}:${reservation.warehouseId}`;
    const releaseLock = await this.dbMutex.acquire(lockKey);

    try {
      const stock = db.stockLevels.find(
        s => s.productId === reservation.productId && s.warehouseId === reservation.warehouseId
      )!;

      if (reservation.status === 'confirmed') {
        return { status: 400, result: { error: 'Already confirmed. Cannot release stock that check out.' } };
      }

      if (reservation.status === 'released') {
        return { status: 200, result: reservation }; // Already released index is idempotent
      }

      // Perform Early Release safely
      reservation.status = 'released';
      stock.reserved = Math.max(0, stock.reserved - reservation.units);

      await this.saveDb();
      console.log(`[Released Early] Reservation ${reservationId} has been manually released.`);

      return { status: 200, result: reservation };
    } finally {
      releaseLock();
    }
  }

  // 7. Get reservation by ID directly
  public async getReservation(reservationId: string): Promise<Reservation | null> {
    // Lazily clean up expired reservations first 
    await this.cleanupExpiredReservations();

    const db = await this.loadDb();
    const r = db.reservations.find(res => res.id === reservationId);
    return r || null;
  }
}

export const dbInstance = new ProductInventoryDb();
