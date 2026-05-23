import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { PrismaClient } from '@prisma/client';
import { lazySweepExpiredReservations } from '../../../lib/db-helper';

// Initialize lazy prisma client
const prisma = new PrismaClient();

// Connect to Upstash Redis wrapper client if environment configuration permits
let redis: Redis | null = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

export async function POST(req: Request) {
  try {
    const { productId, warehouseId, units, holdDurationSeconds } = await req.json();
    const idempotencyKey = req.headers.get('Idempotency-Key');

    if (!productId || !warehouseId || typeof units !== 'number' || units <= 0) {
      return NextResponse.json({
        success: false,
        error: 'Missing required attributes. Specify productId, warehouseId, and a positive units count.'
      }, { status: 400 });
    }

    const holdSeconds = typeof holdDurationSeconds === 'number' ? holdDurationSeconds : 60;

    // 1. Idempotency Check with Redis Cache
    if (idempotencyKey && redis) {
      const cachedResponse = await redis.get(`idempotency:${idempotencyKey}`);
      if (cachedResponse) {
        console.log(`[Idempotency Next.js] Hit cache for key : "${idempotencyKey}"`);
        const payload = typeof cachedResponse === 'string' ? JSON.parse(cachedResponse) : cachedResponse;
        return NextResponse.json(payload, { status: 201 });
      }
    }

    // 2. Concurrency Lock Setup
    const lockKey = `lock:${productId}:${warehouseId}`;
    let hasLock = false;

    if (redis) {
      // Try acquiring distributed lock with 5 seconds expiration to guard the transaction block
      // In @upstash/redis, SET with nx option handles mutual exclusion safely
      const lockedValue = await redis.set(lockKey, 'locked', { nx: true, ex: 5 });
      hasLock = !!lockedValue;

      if (!hasLock) {
        // Concurrency retry lockout
        return NextResponse.json({
          success: false,
          error: 'Concurrency lock is busy. Another request is currently validating this allocation pool. Please retry.'
        }, { status: 409 });
      }
    }

    try {
      // 3. Run a quick passive pre-flight lazy-sweep
      await lazySweepExpiredReservations(prisma);

      // 4. Exec safe Prisma transaction block
      const resultObj = await prisma.$transaction(async (tx) => {
        // Fetch product info
        const prod = await tx.product.findUnique({
          where: { id: productId }
        });
        if (!prod) {
          throw new Error('404_PRODUCT_NOT_FOUND');
        }

        // Fetch current stock
        const stock = await tx.stockLevel.findUnique({
          where: { productId_warehouseId: { productId, warehouseId } }
        });

        if (!stock) {
          throw new Error('404_STOCK_NOT_FOUND');
        }

        const available = stock.total - stock.reserved;
        if (available < units) {
          throw new Error('409_CONFLICT_NOT_ENOUGH_STOCK');
        }

        // Create the reservation hold record
        const expiresAt = new Date(Date.now() + holdSeconds * 1000);
        const reservation = await tx.reservation.create({
          data: {
            productId,
            warehouseId,
            sku: prod.sku,
            units,
            status: 'PENDING',
            expiresAt,
            idempotencyKey
          }
        });

        // Increment holding pool on source warehouse
        await tx.stockLevel.update({
          where: { productId_warehouseId: { productId, warehouseId } },
          data: {
            reserved: { increment: units }
          }
        });

        return reservation;
      });

      const successPayload = { success: true, data: resultObj };

      // Record Idempotency mapping
      if (idempotencyKey && redis) {
        await redis.set(`idempotency:${idempotencyKey}`, JSON.stringify(successPayload), { ex: 86400 });
      }

      return NextResponse.json(successPayload, { status: 201 });

    } finally {
      // 5. Always cleanly release distributed lock
      if (hasLock && redis) {
        await redis.del(lockKey);
      }
    }

  } catch (err: any) {
    console.error('[API Error] Making reservation in Next.js:', err);

    if (err.message === '404_PRODUCT_NOT_FOUND') {
      return NextResponse.json({ success: false, error: 'Product not found.' }, { status: 404 });
    }
    if (err.message === '404_STOCK_NOT_FOUND') {
      return NextResponse.json({ success: false, error: 'Stock mapping not found for this warehouse.' }, { status: 404 });
    }
    if (err.message === '409_CONFLICT_NOT_ENOUGH_STOCK') {
      return NextResponse.json({
        success: false,
        error: 'Not enough available stock at the chosen warehouse to capture this allotment.'
      }, { status: 409 });
    }

    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
