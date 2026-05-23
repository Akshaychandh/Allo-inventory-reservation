/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { dbInstance } from './server/db';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Enable JSON body parsing
  app.use(express.json());

  // Logging middleware 
  app.use((req, res, next) => {
    const now = new Date().toISOString();
    console.log(`[${now}] ${req.method} ${req.url}`);
    next();
  });

  // --- API ROUTES ---

  // 1. GET /api/products - List products with available stock per warehouse
  app.get('/api/products', async (req, res) => {
    try {
      const products = await dbInstance.getProducts();
      res.json({ success: true, data: products });
    } catch (err: any) {
      console.error('[API Error] Fetching products:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. GET /api/warehouses - List warehouses
  app.get('/api/warehouses', async (req, res) => {
    try {
      const warehouses = await dbInstance.getWarehouses();
      res.json({ success: true, data: warehouses });
    } catch (err: any) {
      console.error('[API Error] Fetching warehouses:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. GET /api/reservations/:id - Get specific reservation details
  app.get('/api/reservations/:id', async (req, res) => {
    try {
      const reservation = await dbInstance.getReservation(req.params.id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservation not found.' });
      }
      res.json({ success: true, data: reservation });
    } catch (err: any) {
      console.error('[API Error] Fetching reservation:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. POST /api/reservations - Reserve units for a product/warehouse (concurrency safe)
  app.post('/api/reservations', async (req, res) => {
    try {
      const { productId, warehouseId, units, holdDurationSeconds } = req.body;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      if (!productId || !warehouseId || typeof units !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters. Make sure productId, warehouseId, and units (number) are specified.'
        });
      }

      // Convert holdDuration if provided, default to 60 seconds for easy demo/testing, or 600 seconds (10 mins) as requested
      const parsedDuration = typeof holdDurationSeconds === 'number' ? holdDurationSeconds : 60;

      const { status, result } = await dbInstance.createReservation(
        idempotencyKey,
        productId,
        warehouseId,
        units,
        parsedDuration
      );

      if (status >= 400) {
        return res.status(status).json({ success: false, error: result.error });
      }

      res.status(status).json({ success: true, data: result });
    } catch (err: any) {
      console.error('[API Error] Creating reservation:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. POST /api/reservations/:id/confirm - Confirm reservation (payment succeeded)
  app.post('/api/reservations/:id/confirm', async (req, res) => {
    try {
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
      const { status, result } = await dbInstance.confirmReservation(idempotencyKey, req.params.id);

      if (status >= 400) {
        return res.status(status).json({ success: false, error: result.error });
      }

      res.status(status).json({ success: true, data: result });
    } catch (err: any) {
      console.error('[API Error] Confirming reservation:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. POST /api/reservations/:id/release - Release reservation early (failed/cancelled)
  app.post('/api/reservations/:id/release', async (req, res) => {
    try {
      const { status, result } = await dbInstance.releaseReservation(req.params.id);

      if (status >= 400) {
        return res.status(status).json({ success: false, error: result.error });
      }

      res.status(status).json({ success: true, data: result });
    } catch (err: any) {
      console.error('[API Error] Releasing reservation:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. POST /api/admin/reset - Administrative DB reset for easy testing and evaluation
  app.post('/api/admin/reset', async (req, res) => {
    try {
      await dbInstance.resetDatabase();
      res.json({ success: true, message: 'Database reset to default seeds. All holds cleared.' });
    } catch (err: any) {
      console.error('[API Error] Resetting database:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- SERVICE INTERNALS ---

  // Start background worker to clear expired holdings every 3 seconds to keep UI responsive
  setInterval(async () => {
    try {
      await dbInstance.cleanupExpiredReservations();
    } catch (err) {
      console.error('[Background Sweep Error] Failed sweep process:', err);
    }
  }, 3000);

  // --- VITE MIDDLEWARE INTERACTION ---

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Full-stack Allo application listening on port ${PORT}`);
    console.log(`[Server] Running in ${process.env.NODE_ENV ? process.env.NODE_ENV : 'development'} mode`);
  });
}

startServer();
