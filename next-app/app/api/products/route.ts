import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { lazySweepExpiredReservations } from '../../../lib/db-helper';

const prisma = new PrismaClient();

export async function GET() {
  try {
    // 1. Run dynamic lazy-sweep before loading index
    await lazySweepExpiredReservations(prisma);

    // 2. Fetch products alongside their stock mapping details
    const products = await prisma.product.findMany({
      include: {
        stockLevels: {
          include: {
            warehouse: true
          }
        }
      }
    });

    const formattedData = products.map((prod) => {
      const stocks = prod.stockLevels.map((lvl) => ({
        warehouseId: lvl.warehouseId,
        warehouseName: lvl.warehouse.name,
        warehouseLocation: lvl.warehouse.location,
        total: lvl.total,
        reserved: lvl.reserved,
        available: Math.max(0, lvl.total - lvl.reserved)
      }));

      return {
        id: prod.id,
        sku: prod.sku,
        name: prod.name,
        description: prod.description,
        price: prod.price,
        imageUrl: prod.imageUrl,
        stocks
      };
    });

    return NextResponse.json({ success: true, data: formattedData });
  } catch (err: any) {
    console.error('[API Error] Fetching products:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
