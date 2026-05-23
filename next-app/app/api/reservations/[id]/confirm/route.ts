import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Connect to Upstash Redis wrapper client if environment configuration permits
let redis: Redis | null = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const idempotencyKey = req.headers.get('Idempotency-Key');

    // 1. Idempotency Check with Redis Cache
    if (idempotencyKey && redis) {
      const cachedResponse = await redis.get(`idempotency:${idempotencyKey}`);
      if (cachedResponse) {
        console.log(`[Idempotency Next.js] Hit cache during confirm sequence`);
        const payload = typeof cachedResponse === 'string' ? JSON.parse(cachedResponse) : cachedResponse;
        return NextResponse.json(payload, { status: 200 });
      }
    }

    // 2. Fetch current reservation
    const reservation = await prisma.reservation.findUnique({
      where: { id }
    });

    if (!reservation) {
      return NextResponse.json({ success: false, error: 'Reservation record not found.' }, { status: 404 });
    }

    // Handle terminal idempotencies early
    if (reservation.status === 'CONFIRMED') {
      return NextResponse.json({ success: true, data: reservation }, { status: 200 });
    }

    if (reservation.status === 'RELEASED') {
      return NextResponse.json({ success: false, error: 'Hold expired and was already released.' }, { status: 410 });
    }

    // 3. Expiration Check
    const isExpired = new Date() > new Date(reservation.expiresAt);
    if (isExpired) {
      // Revert stock capacity
      await prisma.$transaction(async (tx) => {
        await tx.reservation.update({
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
      });

      return NextResponse.json({
        success: false,
        error: 'Reservation expired. Units returned to available stock.'
      }, { status: 410 });
    }

    // 4. Confirm Transaction safely
    const updatedRes = await prisma.$transaction(async (tx) => {
      // Transition reservation to CONFIRMED
      const res = await tx.reservation.update({
        where: { id },
        data: { status: 'CONFIRMED' }
      });

      // Permanently decrement holding slot allocations from total physical database balance
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
            total: Math.max(0, stock.total - reservation.units),
            reserved: Math.max(0, stock.reserved - reservation.units)
          }
        });
      }

      return res;
    });

    const successPayload = { success: true, data: updatedRes };

    // Record Idempotency mapping
    if (idempotencyKey && redis) {
      await redis.set(`idempotency:${idempotencyKey}`, JSON.stringify(successPayload), { ex: 86400 });
    }

    return NextResponse.json(successPayload, { status: 200 });

  } catch (err: any) {
    console.error('[API Error] Confirming reservation in Next.js:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
