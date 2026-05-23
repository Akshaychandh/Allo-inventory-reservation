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
  // Leather Backpack
  { productId: 'p1', warehouseId: 'wh-oak', total: 12, reserved: 0 },
  { productId: 'p1', warehouseId: 'wh-bkn', total: 6, reserved: 0 },
  { productId: 'p1', warehouseId: 'wh-atx', total: 1, reserved: 0 }, // Solitary item for race condition testing!

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

async function main() {
  console.log('Seeding Allo database...');

  // 1. Clear existing seed blocks safely
  await prisma.stockLevel.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.product.deleteMany();
  await prisma.warehouse.deleteMany();

  // 2. Insert Products
  for (const product of INITIAL_PRODUCTS) {
    await prisma.product.create({ data: product });
  }
  console.log(`Seeded ${INITIAL_PRODUCTS.length} products.`);

  // 3. Insert Warehouses
  for (const wh of INITIAL_WAREHOUSES) {
    await prisma.warehouse.create({ data: wh });
  }
  console.log(`Seeded ${INITIAL_WAREHOUSES.length} warehouses.`);

  // 4. Insert Starting Stock Levels
  for (const stock of INITIAL_STOCK) {
    await prisma.stockLevel.create({ data: stock });
  }
  console.log(`Seeded ${INITIAL_STOCK.length} Stock Levels.`);

  console.log('Allo database seeding successfully finalized!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
