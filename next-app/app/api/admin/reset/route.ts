import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const INITIAL_PRODUCTS = [
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

const INITIAL_WAREHOUSES = [
  { id: 'wh-oak', name: 'Oakland Logistics Unit', location: 'Oakland, CA' },
  { id: 'wh-bkn', name: 'Brooklyn Fulfillment Depot', location: 'Brooklyn, NY' },
  { id: 'wh-atx', name: 'Austin Central Distribution', location: 'Austin, TX' }
];

const INITIAL_STOCK = [
  { productId: 'p1', warehouseId: 'wh-oak', total: 12, reserved: 0 },
  { productId: 'p1', warehouseId: 'wh-bkn', total: 6, reserved: 0 },
  { productId: 'p1', warehouseId: 'wh-atx', total: 1, reserved: 0 },

  { productId: 'p2', warehouseId: 'wh-oak', total: 45, reserved: 0 },
  { productId: 'p2', warehouseId: 'wh-bkn', total: 30, reserved: 0 },
  { productId: 'p2', warehouseId: 'wh-atx', total: 15, reserved: 0 },

  { productId: 'p3', warehouseId: 'wh-oak', total: 4, reserved: 0 },
  { productId: 'p3', warehouseId: 'wh-bkn', total: 8, reserved: 0 },
  { productId: 'p3', warehouseId: 'wh-atx', total: 2, reserved: 0 },

  { productId: 'p4', warehouseId: 'wh-oak', total: 10, reserved: 0 },
  { productId: 'p4', warehouseId: 'wh-bkn', total: 5, reserved: 0 },
  { productId: 'p4', warehouseId: 'wh-atx', total: 3, reserved: 0 }
];

export async function POST() {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.stockLevel.deleteMany();
      await tx.reservation.deleteMany();
      await tx.product.deleteMany();
      await tx.warehouse.deleteMany();

      for (const prod of INITIAL_PRODUCTS) {
        await tx.product.create({ data: prod });
      }

      for (const wh of INITIAL_WAREHOUSES) {
        await tx.warehouse.create({ data: wh });
      }

      for (const st of INITIAL_STOCK) {
        await tx.stockLevel.create({ data: st });
      }
    });

    return NextResponse.json({ success: true, message: 'Database reset and initial seed populated.' });
  } catch (err: any) {
    console.error('[API Error] Admin reset:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
