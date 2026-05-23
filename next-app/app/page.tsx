"use client";

import { useState, useEffect } from 'react';
import {
  Package,
  Layers,
  MapPin,
  Clock,
  CheckCircle,
  AlertCircle,
  Database,
  Search,
  SlidersHorizontal,
  Lock,
  RefreshCw,
  Info
} from 'lucide-react';

// Define TS Interfaces matching types.ts
interface StockInfo {
  warehouseId: string;
  warehouseName: string;
  warehouseLocation: string;
  total: number;
  reserved: number;
  available: number;
}

interface ProductWithStock {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  stocks: StockInfo[];
}

interface Warehouse {
  id: string;
  name: string;
  location: string;
}

interface Reservation {
  id: string;
  productId: string;
  warehouseId: string;
  sku: string;
  units: number;
  status: string;
  expiresAt: string;
  createdAt: string;
  idempotencyKey?: string;
}

export default function Home() {
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState<string>('ALL');

  const [selectedProduct, setSelectedProduct] = useState<ProductWithStock | null>(null);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [unitsToReserve, setUnitsToReserve] = useState<number>(1);
  const [holdTimerSeconds, setHoldTimerSeconds] = useState<number>(60);

  const [activeReservation, setActiveReservation] = useState<Reservation | null>(null);
  const [activeResWarehouseName, setActiveResWarehouseName] = useState<string>('');
  const [activeResProductName, setActiveResProductName] = useState<string>('');
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [originalHoldDuration, setOriginalHoldDuration] = useState<number>(60);

  const [isReserving, setIsReserving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [concurrencyLog, setConcurrencyLog] = useState<{
    id: string;
    timestamp: string;
    action: string;
    status: number | string;
    payload: any;
    statusType: 'success' | 'warning' | 'error' | 'info';
  }[]>([]);
  
  const [customIdempotencyKey, setCustomIdempotencyKey] = useState<string>('');
  const [useCustomIdempotencyKey, setUseCustomIdempotencyKey] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchInventory = async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const pRes = await fetch('/api/products');
      const pData = await pRes.json();
      if (pData.success) {
        setProducts(pData.data);
      } else {
        setErrorText(pData.error || 'Failed to fetch products');
      }

      const wRes = await fetch('/api/warehouses');
      const wData = await wRes.json();
      if (wData.success) {
        setWarehouses(wData.data);
      }
    } catch (err: any) {
      console.error('Error fetching baseline status:', err);
      setErrorText('Error connecting to Server: ' + err.message);
    } finally {
      if (!silent) setIsRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
    const interval = setInterval(() => {
      if (autoRefresh) {
        fetchInventory(true);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  useEffect(() => {
    if (!activeReservation || activeReservation.status !== 'PENDING') {
      setTimeRemaining(0);
      return;
    }

    const calculateTimeLeft = () => {
      const expiry = new Date(activeReservation.expiresAt).getTime();
      const current = Date.now();
      const diffSeconds = Math.max(0, Math.ceil((expiry - current) / 1000));
      setTimeRemaining(diffSeconds);

      if (diffSeconds <= 0 && activeReservation.status === 'PENDING') {
        setActiveReservation(prev => prev ? { ...prev, status: 'RELEASED' } : null);
        addLog('System expired reservation hold', '410 (Released)', { info: 'Holding window elapsed.' }, 'warning');
        fetchInventory(true);
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(timer);
  }, [activeReservation]);

  const addLog = (
    action: string,
    status: number | string,
    payload: any,
    statusType: 'success' | 'warning' | 'error' | 'info'
  ) => {
    const logItem = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      action,
      status,
      payload,
      statusType
    };
    setConcurrencyLog(prev => [logItem, ...prev].slice(0, 50));
  };

  const autoGenerateIdempotencyKey = () => {
    return 'KEY_' + Math.random().toString(36).substring(2, 10).toUpperCase();
  };

  const handleResetDatabase = async () => {
    if (!confirm('Are you sure you want to reset all inventory counts and clear active holds?')) {
      return;
    }
    try {
      const res = await fetch('/api/admin/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addLog('Database reset triggered', '200 OK', data, 'info');
        setActiveReservation(null);
        setSelectedProduct(null);
        fetchInventory();
      } else {
        alert('Reset failed: ' + data.error);
      }
    } catch (err: any) {
      alert('Network error pointing reset: ' + err.message);
    }
  };

  const handleCreateReservation = async (prodId: string, whId: string, units: number) => {
    setIsReserving(true);
    setErrorText(null);

    const productObj = products.find(p => p.id === prodId);
    const warehouseObj = warehouses.find(w => w.id === whId);
    const keyToUse = useCustomIdempotencyKey && customIdempotencyKey 
      ? customIdempotencyKey 
      : autoGenerateIdempotencyKey();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (keyToUse) {
        headers['Idempotency-Key'] = keyToUse;
      }

      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          productId: prodId,
          warehouseId: whId,
          units: units,
          holdDurationSeconds: holdTimerSeconds
        })
      });

      const data = await response.json();

      if (response.status === 201 && data.success) {
        const resObj: Reservation = data.data;
        setActiveReservation(resObj);
        setActiveResWarehouseName(warehouseObj?.name || whId);
        setActiveResProductName(productObj?.name || 'Product');
        setOriginalHoldDuration(holdTimerSeconds);
        addLog(
          `Reserved ${units} unit(s) of ${productObj?.sku}`,
          `201 Created (Key: ${keyToUse})`,
          resObj,
          'success'
        );
        fetchInventory(true);
      } else {
        const errStr = data.error || 'Conflict occurred and reservation denied.';
        setErrorText(errStr);
        addLog(
          `Reserve Request Rejected [${productObj?.sku}]`,
          `${response.status} Conflict`,
          { error: errStr, key: keyToUse },
          response.status === 409 ? 'warning' : 'error'
        );
      }
    } catch (err: any) {
      console.error(err);
      setErrorText('Connection failure: ' + err.message);
      addLog('Reservation request network error', 'Network Failure', err.message, 'error');
    } finally {
      setIsReserving(false);
      setSelectedProduct(null);
    }
  };

  const handleConfirmReservation = async () => {
    if (!activeReservation) return;
    setIsConfirming(true);
    setErrorText(null);

    const confirmKey = useCustomIdempotencyKey && customIdempotencyKey 
      ? `confirm_${customIdempotencyKey}` 
      : autoGenerateIdempotencyKey();

    try {
      const response = await fetch(`/api/reservations/${activeReservation.id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': confirmKey
        }
      });

      const data = await response.json();

      if (response.status === 200 && data.success) {
        const updatedRes: Reservation = data.data;
        setActiveReservation(updatedRes);
        addLog(
          `Confirmed sale status [Hold ID: ${activeReservation.id}]`,
          `200 OK (Key: ${confirmKey})`,
          updatedRes,
          'success'
        );
        fetchInventory(true);
      } else {
        const errMsg = data.error || 'Failed confirmation.';
        setErrorText(errMsg);
        setActiveReservation(prev => prev ? { ...prev, status: 'RELEASED' } : null);
        addLog(
          `Confirmation Denied [Hold ID: ${activeReservation.id}]`,
          `410 Expired / Gone`,
          { error: errMsg, key: confirmKey },
          'error'
        );
        fetchInventory(true);
      }
    } catch (err: any) {
      console.error(err);
      setErrorText('Confirmation failed: ' + err.message);
      addLog('Confirmation process network issue', 'Network Failure', err.message, 'error');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleReleaseReservationEarly = async () => {
    if (!activeReservation) return;
    setIsReleasing(true);
    setErrorText(null);

    try {
      const response = await fetch(`/api/reservations/${activeReservation.id}/release`, {
        method: 'POST'
      });

      const data = await response.json();

      if (response.status === 200 && data.success) {
        const releasedRes: Reservation = data.data;
        setActiveReservation(releasedRes);
        addLog(
          `Released hold early [Hold ID: ${activeReservation.id}]`,
          '200 Released',
          releasedRes,
          'info'
        );
        fetchInventory(true);
      } else {
        const errStr = data.error || 'Failed release.';
        setErrorText(errStr);
        addLog(
          `Release request rejected`,
          response.status.toString(),
          errStr,
          'error'
        );
      }
    } catch (err: any) {
      console.error(err);
      setErrorText('Release failed: ' + err.message);
    } finally {
      setIsReleasing(false);
    }
  };

  const triggerParallelRaceTest = async () => {
    addLog('Simulating Dual Shoppers checkout race...', 'In Flight', 'Deploying 2 parallel fetch calls targeting Austin warehouse with 1 backpack remaining.', 'info');
    
    const targetProduct = 'p1';
    const targetWarehouse = 'wh-atx';
    const holdDuration = 15;

    const keyA = 'RACE_SHOPPER_A_' + Math.random().toString(36).substring(2, 7).toUpperCase();
    const keyB = 'RACE_SHOPPER_B_' + Math.random().toString(36).substring(2, 7).toUpperCase();

    const reqA = fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyA },
      body: JSON.stringify({ productId: targetProduct, warehouseId: targetWarehouse, units: 1, holdDurationSeconds: holdDuration })
    }).then(r => r.json().then(data => ({ name: 'Shopper A (Vince)', status: r.status, data })));

    const reqB = fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyB },
      body: JSON.stringify({ productId: targetProduct, warehouseId: targetWarehouse, units: 1, holdDurationSeconds: holdDuration })
    }).then(r => r.json().then(data => ({ name: 'Shopper B (Sarah)', status: r.status, data })));

    try {
      const results = await Promise.all([reqA, reqB]);
      const successResult = results.find(r => r.status === 201);
      const conflictResult = results.find(r => r.status === 409);

      if (successResult) {
        addLog(
          `[Concurrency Success] ${successResult.name} secured the reservation!`,
          '201 Created',
          { databaseResponse: successResult.data.data, key: keyA },
          'success'
        );
        setActiveReservation(successResult.data.data);
        setActiveResWarehouseName('Austin Central Distribution');
        setActiveResProductName('Allo Leather Backpack');
        setOriginalHoldDuration(holdDuration);
      } else {
        addLog(
          '[Concurrency Issue] No request succeeded (Perhaps zero starting inventory?)',
          'Failed Test',
          results,
          'error'
        );
      }

      if (conflictResult) {
        addLog(
          `[Concurrency Lock Guard] Parallel request for ${conflictResult.name} was rejected to prevent double-selling.`,
          '409 Conflict',
          { serverResponse: conflictResult.data.error, key: keyB },
          'warning'
        );
        setErrorText(`Conflict Blocked: ${conflictResult.data.error}`);
      }

      fetchInventory(true);
    } catch (err: any) {
      addLog('Race simulation fetch crashed', 'Simulation Jammed', err.message, 'error');
    }
  };

  const filteredProducts = products.filter(product => {
    const query = searchQuery.trim().toLowerCase();
    const skuMatch = product.sku.toLowerCase().includes(query) || product.name.toLowerCase().includes(query) || product.description.toLowerCase().includes(query);
    
    if (!skuMatch) return false;
    
    if (selectedWarehouseFilter !== 'ALL') {
      const hasWarehouseStock = product.stocks.some(
        st => st.warehouseId === selectedWarehouseFilter && st.total > 0
      );
      return hasWarehouseStock;
    }
    return true;
  });

  const progressPercent = activeReservation && timeRemaining > 0
    ? (timeRemaining / originalHoldDuration) * 100
    : 0;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#1e293b] font-sans flex flex-col">
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shadow-xs z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center shadow-md">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-lg tracking-tight text-slate-900 leading-none">Allo</span>
              <span className="text-xs font-semibold px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-md">ERP</span>
            </div>
            <p className="text-[10px] text-slate-500 font-mono tracking-wider">Multi-Warehouse Fulfillment Guard (Next.js Deploy)</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full text-xs font-semibold">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> 
            Lock Guard Active
          </div>
          <button
            onClick={handleResetDatabase}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold transition-all shadow-xs cursor-pointer"
          >
            <Database className="w-3.5 h-3.5" />
            Reset DB
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        <aside className="w-full lg:w-64 bg-slate-50 border-r border-slate-200 p-5 flex flex-col gap-5">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest block mb-2 px-1">Inventory Filters</span>
            <div className="space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="SKU, Name, or Key..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-md text-xs outline-hidden focus:ring-2 focus:ring-indigo-500/30 bg-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Fulfillment Source</label>
                <select
                  value={selectedWarehouseFilter}
                  onChange={(e) => setSelectedWarehouseFilter(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-md text-xs bg-white outline-hidden"
                >
                  <option value="ALL">All Warehouses Combined</option>
                  {warehouses.map((wh) => (
                    <option key={wh.id} value={wh.id}>
                      {wh.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <hr className="border-slate-200" />

          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest block">Hold Settings</span>
              <SlidersHorizontal className="w-3 h-3 text-slate-400" />
            </div>
            <div className="space-y-3 bg-white p-3 rounded-lg border border-slate-200 shadow-2xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Hold Window: <span className="font-bold text-indigo-600 font-mono">{holdTimerSeconds}s</span>
                </label>
                <input
                  type="range"
                  min="5"
                  max="600"
                  step="5"
                  value={holdTimerSeconds}
                  onChange={(e) => setHoldTimerSeconds(Number(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>

              <div className="pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustomIdempotencyKey}
                    onChange={(e) => setUseCustomIdempotencyKey(e.target.checked)}
                    className="rounded-sm border-slate-300 text-indigo-600 h-3.5 w-3.5"
                  />
                  <span className="text-xs font-semibold text-slate-700">Simulate Idempotency</span>
                </label>
                
                {useCustomIdempotencyKey && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-slate-500">Idempotency-Key Header:</span>
                      <button 
                        onClick={() => setCustomIdempotencyKey(autoGenerateIdempotencyKey())}
                        className="text-[9px] text-indigo-600 underline"
                      >
                        Roll Key
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="e.g. REQ-UID-282"
                      value={customIdempotencyKey}
                      onChange={(e) => setCustomIdempotencyKey(e.target.value)}
                      className="w-full px-2 py-1 border border-slate-300 rounded font-mono text-[10px] bg-slate-50 uppercase"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-auto p-4 bg-indigo-50/60 rounded-xl border border-indigo-100">
            <div className="flex items-center gap-1.5 text-indigo-900 mb-1">
              <Lock className="w-3.5 h-3.5 stroke-indigo-600" />
              <span className="text-xs font-bold font-mono">Concurrency Protection</span>
            </div>
            <p className="text-[10px] text-indigo-700 leading-normal mb-2">
              Locks are handled per <b>sku:warehouse</b> block using Upstash Redis distributed keys to guarantee absolutely safe parallel orders.
            </p>
            <button
              onClick={triggerParallelRaceTest}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-1.5 px-2 rounded flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
            >
              <Package className="w-3 h-3" />
              Trigger Parallel Race Test
            </button>
          </div>
        </aside>

        <main className="flex-1 p-6 flex flex-col gap-6 overflow-x-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Live Inventory Ledger
                {isRefreshing && <RefreshCw className="w-4 h-4 text-indigo-500 animate-spin" />}
              </h1>
              <p className="text-xs text-slate-500">
                Verify multi-warehouse stocks, pending holds, and simulate concurrent traffic safely.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded-sm border-slate-300 text-indigo-600"
                />
                Live Auto-Stream (4s)
              </label>
              <button
                onClick={() => fetchInventory()}
                disabled={isRefreshing}
                className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg transition-all inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reload Now
              </button>
            </div>
          </div>

          {errorText && (
            <div className="bg-rose-50 border border-rose-100 text-rose-800 rounded-lg p-3.5 text-xs flex items-start gap-2.5 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Transaction Conflict / Action Denied</p>
                <p className="opacity-95">{errorText}</p>
              </div>
              <button
                onClick={() => setErrorText(null)}
                className="text-[10px] font-bold uppercase tracking-wider text-rose-700 hover:underline px-1 shrink-0 ml-auto"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-indigo-500" />
                  <span className="font-bold text-xs text-slate-700 uppercase tracking-wider">Multi-Warehouse Allocation Matrix</span>
                </div>
              </div>

              {loading ? (
                <div className="p-12 text-center text-slate-400 text-xs">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-500 mx-auto mb-2" />
                  Syncing matrix...
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-xs">
                  No products available.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                      <tr>
                        <th className="px-4 py-3">Product Detail</th>
                        <th className="px-4 py-3">Warehouse Unit</th>
                        <th className="px-4 py-3 text-center">Total Physical</th>
                        <th className="px-4 py-3 text-center">Active Reservation</th>
                        <th className="px-4 py-3 text-center">Available Stock</th>
                        <th className="px-4 py-3 text-right">Commit Flow</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredProducts.flatMap((product) => {
                        const displayedStocks = product.stocks.filter(st => 
                          selectedWarehouseFilter === 'ALL' || st.warehouseId === selectedWarehouseFilter
                        );

                        return displayedStocks.map((st, index) => {
                          const isScarce = st.available <= 2 && st.available > 0;
                          const isNoStock = st.available === 0;

                          return (
                            <tr key={`${product.id}-${st.warehouseId}`} className="hover:bg-slate-50/50">
                              <td className="px-4 py-3.5">
                                {index === 0 && (
                                  <div className="flex gap-3">
                                    <img 
                                      src={product.imageUrl} 
                                      alt="" 
                                      className="w-10 h-10 object-cover rounded-md border" 
                                    />
                                    <div>
                                      <div className="font-semibold text-slate-900">{product.name}</div>
                                      <div className="text-[10px] text-slate-500 font-mono">
                                        <span className="bg-slate-100 px-1 py-0.5 rounded text-indigo-700 font-bold">{product.sku}</span>
                                        <span className="mx-1">•</span>
                                        <span>${product.price} USD</span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="flex items-center gap-1">
                                  <MapPin className="w-3 h-3 text-slate-400" />
                                  <span className="font-semibold text-slate-800">{st.warehouseName}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3.5 text-center font-mono text-slate-700">
                                {st.total}
                              </td>
                              <td className="px-4 py-3.5 text-center font-mono text-amber-600">
                                {st.reserved > 0 ? st.reserved : '—'}
                              </td>
                              <td className="px-4 py-3.5 text-center font-mono">
                                {isNoStock ? (
                                  <span className="px-1.5 py-0.5 bg-red-50 text-red-700 rounded text-[9px] font-bold">Out</span>
                                ) : isScarce ? (
                                  <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[9px] font-bold animate-pulse">Low ({st.available})</span>
                                ) : (
                                  <span className="font-bold text-slate-900">{st.available}</span>
                                )}
                              </td>
                              <td className="px-4 py-3.5 text-right">
                                <button
                                  onClick={() => {
                                    setSelectedProduct(product);
                                    setSelectedWarehouseId(st.warehouseId);
                                    setUnitsToReserve(1);
                                  }}
                                  disabled={isNoStock}
                                  className="text-[11px] px-2.5 py-1 text-indigo-600 bg-indigo-50 hover:bg-indigo-600 hover:text-white rounded font-bold cursor-pointer transition-all"
                                >
                                  Reserve
                                </button>
                              </td>
                            </tr>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-slate-900 text-white rounded-xl shadow-lg p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Live Cashier Terminal</span>
                {activeReservation && (
                  <span className="px-2 py-0.5 bg-indigo-500 text-white rounded text-[9px] font-bold">
                    {activeReservation.status}
                  </span>
                )}
              </div>

              {!activeReservation ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-xs text-slate-400">
                  <Clock className="w-8 h-8 text-slate-600 mb-2" />
                  <p className="font-semibold text-slate-300">No Hold Active</p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col">
                  {activeReservation.status === 'PENDING' && (
                    <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-800 mb-4 text-center">
                      <div className="text-[10px] text-indigo-400 font-medium flex items-center justify-center gap-1.5 mb-1">
                        HOLD SECURED
                      </div>
                      <div className="text-3xl font-mono font-bold leading-none mb-2 text-white">
                        {timeRemaining > 0 ? `${Math.floor(timeRemaining / 60)}:${(timeRemaining % 60).toString().padStart(2, '0')}` : '00:00'}
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${progressPercent}%` }}></div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3 p-3 bg-slate-800/20 border border-slate-800 rounded-lg text-xs mb-4">
                    <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                      <span className="text-slate-400">SKU</span>
                      <span className="font-semibold text-white">{activeReservation.sku}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                      <span className="text-slate-400">Quantity</span>
                      <span className="font-bold text-white">{activeReservation.units}x</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Warehouse</span>
                      <span className="text-slate-200">{activeResWarehouseName}</span>
                    </div>
                  </div>

                  {activeReservation.status === 'PENDING' ? (
                    <div className="space-y-2 mt-auto">
                      <button
                        onClick={handleConfirmReservation}
                        disabled={isConfirming}
                        className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-bold text-xs hover:bg-indigo-700 cursor-pointer"
                      >
                        Confirm Purchase
                      </button>
                      <button
                        onClick={handleReleaseReservationEarly}
                        disabled={isReleasing}
                        className="w-full py-2 bg-slate-800 text-slate-300 rounded-lg font-bold text-xs hover:bg-slate-700 cursor-pointer"
                      >
                        Cancel Reservation Hold
                      </button>
                    </div>
                  ) : activeReservation.status === 'CONFIRMED' ? (
                    <div className="mt-auto space-y-3 bg-emerald-950/20 border border-emerald-900 p-4 rounded-lg text-center">
                      <CheckCircle className="w-6 h-6 text-emerald-500 mx-auto" />
                      <p className="text-xs font-bold text-emerald-400">Payment Verified!</p>
                      <button onClick={() => setActiveReservation(null)} className="text-xs text-slate-400 underline">Close</button>
                    </div>
                  ) : (
                    <div className="mt-auto p-4 bg-slate-800 rounded-lg text-center">
                      <p className="text-xs font-bold text-slate-300">Released / Expired</p>
                      <button onClick={() => setActiveReservation(null)} className="text-xs text-indigo-400 underline mt-2">Close</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {selectedProduct && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl max-w-md w-full border border-slate-200 text-xs">
                <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
                  <h3 className="font-bold text-slate-900">Secure Hold</h3>
                  <button onClick={() => setSelectedProduct(null)} className="text-slate-400">✕</button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex gap-3 bg-slate-50 p-2.5 rounded-lg border">
                    <img src={selectedProduct.imageUrl} className="w-10 h-10 object-cover rounded" alt="" />
                    <div>
                      <h4 className="font-bold text-slate-900">{selectedProduct.name}</h4>
                      <p className="font-mono text-indigo-600">{selectedProduct.sku}</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-600 font-medium">Quantity to Reserve</label>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => setUnitsToReserve(Math.max(1, unitsToReserve - 1))} className="w-8 h-8 border rounded font-mono">-</button>
                      <span className="font-bold text-sm w-8 text-center">{unitsToReserve}</span>
                      <button onClick={() => setUnitsToReserve(unitsToReserve + 1)} className="w-8 h-8 border rounded font-mono">+</button>
                    </div>
                  </div>
                </div>
                <div className="p-3.5 bg-slate-50 border-t flex justify-end gap-2">
                  <button onClick={() => setSelectedProduct(null)} className="px-3 py-1.5 border rounded">Cancel</button>
                  <button onClick={() => handleCreateReservation(selectedProduct.id, selectedWarehouseId, unitsToReserve)} className="px-4 py-1.5 bg-indigo-600 text-white rounded font-bold">
                    Reserve
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Telemetry Logger */}
          <div className="bg-white border rounded-xl overflow-hidden shadow-2xs">
            <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
              <span className="font-bold text-xs text-slate-700 uppercase tracking-wider">Transaction Resiliency Log</span>
              <button onClick={() => setConcurrencyLog([])} className="text-xs text-indigo-600 hover:underline">Clear</button>
            </div>
            <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto p-2 font-mono text-[10px]">
              {concurrencyLog.length === 0 ? (
                <p className="text-center text-slate-400 py-6">Telemetry stream idle.</p>
              ) : (
                concurrencyLog.map((log) => (
                  <div key={log.id} className="p-2 hover:bg-slate-50 flex items-start gap-4">
                    <span className="text-slate-400 shrink-0">{log.timestamp}</span>
                    <span className="font-bold text-indigo-600 shrink-0">{log.action}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      log.statusType === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                      log.statusType === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                      log.statusType === 'error' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                      'bg-slate-50 text-slate-700 border border-slate-100'
                    }`}>
                      {log.status}
                    </span>
                    <span className="text-slate-500 truncate">{JSON.stringify(log.payload)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
