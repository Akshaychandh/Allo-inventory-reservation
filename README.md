# Allo Inventory & Order-Fulfillment Platform

An advanced, concurrency-safe inventory and order-fulfillment platform built for multi-warehouse retail operations. This platform prevents double-selling and under-selling through real-time reservation locking mechanisms, protecting customer trust and merchant stock integrity.

## 🌟 Key Features

1. **Multi-Warehouse Allocation Matrix**: Real-time visualization of warehouse stocks with live filters, low-stock warnings, and transactional reservation workflows.
2. **Deterministic Concurrency Lock Guard**: An asynchronous, serialized key-mutex state locks coordinator that isolates operations on specific `sku:warehouse` pairs. This eliminates race conditions entirely when multiple parallel checkout sequences compete for rare units.
3. **Idempotency Simulator**: Transparent support for client-provided `Idempotency-Key` headers on transaction endpoints, returning cached results of original executions on retries without repeating side-effects.
4. **Resiliency Testing Console**: An interactive, live sandbox where developers can fire simultaneous requests to race-test the lock coordinator with 1 stock unit of a rare SKU.
5. **Duo-Tier Expirations**: Combine aggressive interval-based background workers with on-demand lazy expiration sweeps to ensure perfectly timely stock releases when holds expire.

---

## 🛠️ Tech Stack & Architecture

We provide **two** implementations of this app:
1. **Developer Sandbox**: Full-stack Express & local memory JSON file DB inside Vite (ready inside the root folder).
2. **Production/Vercel (The Assignment Standard)**: Premium full-stack **Next.js (App Router)** containing **Prisma Client (PostgreSQL)**, **Supabase Host**, and **Upstash Redis** for distributed locking and response idling. Located inside `/next-app/`.

### 1. Concurrency Control Approach (Distributed Redis Locks)
To protect transaction boundaries inside serverless functions (like Vercel and Next.js API Routes), we implement a **Distributed Lock manager** via Upstash Redis.
- When an order-hold (`POST /api/reservations`) comes in, the server immediately evaluates a unique global Redis lock key: `lock:${productId}:${warehouseId}`.
- Setting this key is done with `nx: true` and `ex: 5` (expires in 5 seconds). If another thread already holds the lock, the response returns an immediate `409 Conflict: Lock busy`.
- This ensures that if only **1 unit** remains in stock and multiple shoppers click reserve at the exact same millisecond across different nodes, exactly one thread acquires the lock, validates available stock levels inside a safe PostgreSQL transaction block, writes the hold, and commits. The other shopper is safely rejected, preventing double-sell.

### 2. Expiry Mechanism (Duo-Tier in Production)
How expiry works securely in serverless server environments (where background intervals are unreliable):
- **Lazy Evaluation Sweep**: Every runtime read operation (listing products or reviewing individual reservations) automatically fires a pre-flight sweep function first. This sweep identifies unconfirmed expired holds, changes their status to `RELEASED`, and returns reserved increments back to the available stock pool. This ensures that customers always see perfect, up-to-the-millisecond stock without relying on persistent server timers.
- **Background Cron / Webhook Sweep (Optional but recommended)**: A standard serverless cron trigger (e.g. Vercel Cron or GitHub Action calling `GET /api/products` or a dedicated endpoint) can be configured to run once every minute to ensure cleanup happens even if the site is experiencing low traffic.

### 3. Idempotency Implementation
Both reservation and confirmation routes accept an optional `Idempotency-Key` header.
- Upon receiving a key, the router inspects the Upstash Redis cached response index.
- If a match is found, the server bypasses database queries altogether and responds immediately with the cached status code and payload.
- This prevents side-effects such as duplicate charges or multiple reservation allocations if the client retries due to a flaky internet connection.

---

## ⚡ Next.js Deployment & Setup Guide (Step-by-Step)

All code files for the Next.js deployment are fully-authored and self-contained inside the `/next-app` directory!

### Step 1: Export Your Project
Download your code from AI Studio. You can choose **"Download ZIP"** or **"Export to GitHub"** in the Settings menu of your AI Studio interface. The directory contains the root sandbox code and the specialized `/next-app` folders.

### Step 2: Set Up Your Hosted Databases
1. **PostgreSQL (Supabase, Neon, or Railway)**:
   - Create a free project on [Supabase](https://supabase.com).
   - Retrieve your database URI connection string. Make sure to use the **Transaction connection pool string** (or direct connection string for Prisma).
2. **Redis (Upstash)**:
   - Create a free database on [Upstash Console](https://upstash.com).
   - Retrieve your `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

### Step 3: Run the Next.js App Locally
Navigate into the `/next-app` directory:
```bash
cd next-app
```

Create a `.env` file from the placeholder templates:
```env
DATABASE_URL="postgresql://postgres:your_password@your-database-host.supabase.co:5432/postgres?pgbouncer=true"
UPSTASH_REDIS_REST_URL="https://your-database.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your-token"
```

Install local Next.js dependencies:
```bash
npm install
```

Generate your local Prisma Client mapping schemas:
```bash
npm run prisma:generate
```

Push the database tables structure directly to your hosted PostgreSQL database:
```bash
npm run prisma:migrate
```

Seed your databases with initial stock levels, scarcity levels, products, and warehouses:
```bash
npm run prisma:seed
```

Boot the Next.js local developer server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view your Next.js dashboard!

### Step 4: Deploy to Vercel
1. Create a public repository on your personal **GitHub** account and push the contents of the `/next-app` directory to its root level.
2. Sign in to your [Vercel](https://vercel.com) account and click **Add New > Project**.
3. Import your GitHub repository.
4. Expand the **Environment Variables** panel and add your secrets:
   - `DATABASE_URL`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
5. Click **Deploy**! Your app will compile and generate your live, production-ready allocation matrix URL.

---

## ⚖️ Trade-offs & Future Enhancements
With more time, we would implement:
1. **Optimistic UI Updates**: Instantly reflect tentative holds in the client state before the server response completes to make the user interface feel snappy, reverting seamlessly if a 409 conflict occurs.
2. **Redis-based Rate Limiting**: Implement Upstash rate-limit headers to prevent malicious users from spamming reservations and intentionally locking up stock values.
3. **Optimistic Locking Guard**: Use Postgres native row versioning (`version` metadata column) alongside Redis locks to have a multi-layered check defense if Redis becomes unreachable.

