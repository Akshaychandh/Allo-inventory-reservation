import { PrismaClient } from '@prisma/client';

export async function lazySweepExpiredReservations(prisma: PrismaClient) {
  const now = new Date();

  // 1. Fetch pending holds that have elapsed their expirations
  const expiredHolds = await prisma.reservation.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: now }
    }
  });

  if (expiredHolds.length === 0) return 0;

  console.log(`[Sweep] Cleaving ${expiredHolds.length} expired reservations...`);

  let count = 0;
  for (const hold of expiredHolds) {
    try {
      await prisma.$transaction(async (tx) => {
        // Double-check the hold status is still PENDING within transactional boundaries
        const currentHold = await tx.reservation.findUnique({
          where: { id: hold.id }
        });

        if (currentHold && currentHold.status === 'PENDING') {
          // Release status
          await tx.reservation.update({
            where: { id: hold.id },
            data: { status: 'RELEASED' }
          });

          // Decrement reserved levels on stock mapping
          const stock = await tx.stockLevel.findUnique({
            where: {
              productId_warehouseId: {
                productId: hold.productId,
                warehouseId: hold.warehouseId
              }
            }
          });

          if (stock) {
            await tx.stockLevel.update({
              where: {
                productId_warehouseId: {
                  productId: hold.productId,
                  warehouseId: hold.warehouseId
                }
              },
              data: {
                reserved: Math.max(0, stock.reserved - hold.units)
              }
            });
          }
          count++;
        }
      });
    } catch (err) {
      console.error(`[Sweep Error] Failed to expire hold ID ${hold.id}:`, err);
    }
  }

  return count;
}
