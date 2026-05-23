/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
}

export interface Warehouse {
  id: string;
  name: string;
  location: string;
}

export interface StockLevel {
  productId: string;
  warehouseId: string;
  total: number;
  reserved: number;
}

export type ReservationStatus = 'pending' | 'confirmed' | 'released';

export interface Reservation {
  id: string;
  productId: string;
  warehouseId: string;
  sku: string;
  units: number;
  status: ReservationStatus;
  expiresAt: string; // ISO String
  createdAt: string; // ISO String
  idempotencyKey?: string;
}

export interface StockInfo {
  warehouseId: string;
  warehouseName: string;
  warehouseLocation: string;
  total: number;
  reserved: number;
  available: number;
}

export interface ProductWithStock extends Product {
  stocks: StockInfo[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
