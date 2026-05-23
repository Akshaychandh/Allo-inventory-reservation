import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Fetch reservation
    const reservation = await prisma.reservation.findUnique({
      where: { id }
    });

    if (!reservation) {
      return NextResponse.json({ success: false, error: 'Reservation record not found.' }, { status: 404 });
    }

    if (reservation.status === 'CONFIRMED') {
      return NextResponse.json({ success: false, error: 'Stock transaction already finalized. Cannot release confirmed units.' }, { status: 400 });
    }

    if (reservation.status === 'RELEASED') {
      return NextResponse.json({ success: true, data: reservation }, { status: 200 }); // Idempotent
    }

    // 2. Transact release state
    const releasedRes = await prisma.$transaction(async (tx) => {
      const res = await tx.reservation.update({
        where: { id },
        data: { status: 'RELEASED' }
      });

      const stock = await tx.stockLevel.findUnique({
        where: {
          productId_warehouseId: {
            productId: reservation.productId,
            warehouseId: reservation.warehouseId
          }
        }
      });

      if (stock) {
        await tx.stockLevel.update({
          where: {
            productId_warehouseId: {
              productId: reservation.productId,
              warehouseId: reservation.warehouseId
            }
          },
          data: {
            reserved: Math.max(0, stock.reserved - reservation.units)
          }
        });
      }

      return res;
    });

    return NextResponse.json({ success: true, data: releasedRes }, { status: 200 });

  } catch (err: any) {
    console.error('[API Error] Releasing reservation in Next.js:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
