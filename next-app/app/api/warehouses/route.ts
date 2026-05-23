import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const warehouses = await prisma.warehouse.findMany();
    return NextResponse.json({ success: true, data: warehouses });
  } catch (err: any) {
    console.error('[API Error] Fetching warehouses:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
