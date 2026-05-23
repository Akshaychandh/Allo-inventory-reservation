/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
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
  Trash2,
  HelpCircle,
  Info
} from 'lucide-react';
import { ProductWithStock, Reservation, Warehouse } from './types';

// Let's create an elegant UI matching the Professional Polish specifications.
export default function App() {
  // Inventory status state
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Search and filter options
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState<string>('ALL');

  // Interactive Reservation parameters
  const [selectedProduct, setSelectedProduct] = useState<ProductWithStock | null>(null);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [unitsToReserve, setUnitsToReserve] = useState<number>(1);
  const [holdTimerSeconds, setHoldTimerSeconds] = useState<number>(60); // 60s default for easy demo testing, 600s is 10 mins

  // Active reservation state (stored locally so we can track the active checkout flow)
  const [activeReservation, setActiveReservation] = useState<Reservation | null>(null);
  const [activeResWarehouseName, setActiveResWarehouseName] = useState<string>('');
  const [activeResProductName, setActiveResProductName] = useState<string>('');
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [originalHoldDuration, setOriginalHoldDuration] = useState<number>(60);

  // Operation indicators state
  const [isReserving, setIsReserving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Concurrency & Idempotency Testing Area
  const [concurrencyLog, setConcurrencyLog] = useState<{
    id: string;
    timestamp: string;
    action: string;
    status: number | string;
    payload: any;
    statusType: 'success' | 'warning' | 'error' | 'info';
  }[]>([]);
  
  // Custom Idempotency Key Simulator Input
  const [customIdempotencyKey, setCustomIdempotencyKey] = useState<string>('');
  const [useCustomIdempotencyKey, setUseCustomIdempotencyKey] = useState<boolean>(false);

  // Auto-refresh state toggle
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Load baseline inventory details
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

  // Setup periodic refresh
  useEffect(() => {
    fetchInventory();

    const interval = setInterval(() => {
      if (autoRefresh) {
        fetchInventory(true);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Synchronous and persistent clock countdown for active reservations
  useEffect(() => {
    if (!activeReservation || activeReservation.status !== 'pending') {
      setTimeRemaining(0);
      return;
    }

    const calculateTimeLeft = () => {
      const expiry = new Date(activeReservation.expiresAt).getTime();
      const current = Date.now();
      const diffSeconds = Math.max(0, Math.ceil((expiry - current) / 1000));
      setTimeRemaining(diffSeconds);

      // Lazy notify when timer hits zero
      if (diffSeconds <= 0 && activeReservation.status === 'pending') {
        setActiveReservation(prev => prev ? { ...prev, status: 'released' } : null);
        addLog('System expired reservation hold', '410 (Released)', { info: 'Holding window elapsed.' }, 'warning');
        fetchInventory(true);
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(timer);
  }, [activeReservation]);

  // Helper to append telemetry logger events
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

  // Generate randomized custom idempotency key
  const autoGenerateIdempotencyKey = () => {
    return 'key_' + Math.random().toString(36).substring(2, 10).toUpperCase();
  };

  // Handler for administrative database reset
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

  // Trigger reservation hold request
  const handleCreateReservation = async (prodId: string, whId: string, units: number) => {
    setIsReserving(true);
    setErrorText(null);

    const productObj = products.find(p => p.id === prodId);
    const warehouseObj = warehouses.find(w => w.id === whId);

    // Pick dynamic idempotency key or default fallback
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
        // Success
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
        // Handle 409 Conflict state explicitly
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
      // Reset state selections
      setSelectedProduct(null);
    }
  };

  // Confirm reservation (checkout payment transition)
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
          `Confirmed sale confirmation [Hold ID: ${activeReservation.id}]`,
          `200 OK (Key: ${confirmKey})`,
          updatedRes,
          'success'
        );
        fetchInventory(true);
      } else {
        // Handle 410 Expired explicitly
        const errMsg = data.error || 'Failed confirmation.';
        setErrorText(errMsg);
        setActiveReservation(prev => prev ? { ...prev, status: 'released' } : null);
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

  // Release reservation early (failed checkout or early cancel)
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

  // CONCURRENCY LAB: Simulate real parallel checkout race on extremely limited stock
  // We'll query Austin Central Distribution for Allo Leather Backpack (which starts at total 1, reserved 0).
  // Clicking this simulates shopper A and shopper B hitting "Buy" in exact parallel!
  const triggerParallelRaceTest = async () => {
    // We choose the highly scarce Leather Backpack 'p1' at 'wh-atx' (Austin Distribution), which has default 1 stock.
    addLog('Simulating Dual Shoppers checkout race...', 'In Flight', 'Deploying 2 parallel fetch calls targeting Austin warehouse with 1 backpack remaining.', 'info');
    
    const targetProduct = 'p1';
    const targetWarehouse = 'wh-atx';
    const holdDuration = 15; // Set short 15s hold for testing

    const keyA = 'RACE_SHOPPER_A_' + Math.random().toString(36).substring(2, 7).toUpperCase();
    const keyB = 'RACE_SHOPPER_B_' + Math.random().toString(36).substring(2, 7).toUpperCase();

    // Fire both fetch calls in immediate parallel using Promise.all!
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
      
      // Sort so we categorize success vs conflict
      const successResult = results.find(r => r.status === 201);
      const conflictResult = results.find(r => r.status === 409);

      if (successResult) {
        addLog(
          `[Concurrency Success] ${successResult.name} secured the reservation!`,
          '201 Created',
          { databaseResponse: successResult.data.data, key: keyA },
          'success'
        );
        // Set as active reservation
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

  // Filter products by search keywords and selected warehouse
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

  // Calculate percentage of timer remaining
  const progressPercent = activeReservation && timeRemaining > 0
    ? (timeRemaining / originalHoldDuration) * 100
    : 0;

  return (
    <div id="allo-reservation-workspace" className="min-h-screen bg-[#f8fafc] text-[#1e293b] font-sans flex flex-col">
      {/* Header Bar */}
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shadow-xs z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center shadow-md shadow-indigo-600/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-lg tracking-tight text-slate-900 leading-none">Allo</span>
              <span className="text-xs font-semibold px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-md">ERP</span>
            </div>
            <p className="text-[10px] text-slate-500 font-mono tracking-wider">Multi-Warehouse Fulfillment Guard</p>
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
            title="Reset storage engine to clear all locks and reload full inventory defaults"
          >
            <Database className="w-3.5 h-3.5" />
            Reset DB
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left Control Column */}
        <aside className="w-full lg:w-64 bg-slate-50 border-r border-slate-200 p-5 flex flex-col gap-5">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest block mb-2 px-1">Inventory Filters</span>
            <div className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="SKU, Name, or Key..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-md text-xs outline-hidden focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 bg-white shadow-xs"
                />
              </div>

              {/* Warehouse Selection */}
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Fulfillment Source</label>
                <select
                  value={selectedWarehouseFilter}
                  onChange={(e) => setSelectedWarehouseFilter(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-md text-xs bg-white outline-hidden focus:ring-2 focus:ring-indigo-500/30"
                >
                  <option value="ALL">All Warehouses Combined</option>
                  {warehouses.map((wh) => (
                    <option key={wh.id} value={wh.id}>
                      {wh.name} ({wh.location})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <hr className="border-slate-200" />

          {/* Configuration Settings Panel */}
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
                <div className="flex justify-between text-[9px] text-slate-400 font-mono mt-1">
                  <span>5s (Fast Dev)</span>
                  <span>10m (Retail Std)</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustomIdempotencyKey}
                    onChange={(e) => setUseCustomIdempotencyKey(e.target.checked)}
                    className="rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
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
                    <p className="text-[9px] text-slate-400 mt-1 italic">
                      Subsequent identical requests bypass processing and serve original cache.
                    </p>
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
              Locks are generated per <b>sku:warehouse</b> key using a serialized asynchronous key-mutex lock sequence to guarantee absolutely safe order flows.
            </p>
            <button
              onClick={triggerParallelRaceTest}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-1.5 px-2 rounded flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
            >
              <Package className="w-3 h-3" />
              Trigger Parallel Race Test
            </button>
            <p className="text-[9px] text-slate-400 text-center uppercase tracking-wide font-medium mt-1">
              Runs 2 immediate concurrent requests
            </p>
          </div>
        </aside>

        {/* Main Workspace Frame */}
        <main className="flex-1 p-6 flex flex-col gap-6 overflow-x-hidden">
          {/* Dashboard Header Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Live Inventory Ledger
                {isRefreshing && <RefreshCw className="w-4 h-4 text-indigo-500 animate-spin" />}
              </h1>
              <p className="text-xs text-slate-500">
                Verify multi-warehouse stock allocations, pending reservations, and process real-time holds.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Live Auto-Stream (4s)
              </label>
              <button
                onClick={() => fetchInventory()}
                disabled={isRefreshing}
                className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg transition-all shadow-xs inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reload Now
              </button>
            </div>
          </div>

          {/* Status Display Banners / Error Reports */}
          {errorText && (
            <div className="bg-rose-50 border border-rose-100 text-rose-800 rounded-lg p-3.5 text-xs flex items-start gap-2.5 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Transaction Conflict / Action Denied</p>
                <p className="opacity-90">{errorText}</p>
              </div>
              <button
                onClick={() => setErrorText(null)}
                className="text-[10px] font-bold uppercase tracking-wider text-rose-700 hover:underline px-1 shrink-0 ml-auto"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Upper Section: Active Hold and Stock grid */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            
            {/* Stock Levels Matrix Column (2 cols on wide screen) */}
            <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-indigo-500" />
                  <span className="font-bold text-xs text-slate-700 uppercase tracking-wider">Multi-Warehouse Allocation Matrix</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">Showing {filteredProducts.length} unique SKUs</span>
              </div>

              {loading ? (
                <div className="p-12 text-center text-slate-400 text-xs">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-500 mx-auto mb-2" />
                  Streaming index records...
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-xs">
                  <AlertCircle className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                  No stock allocations match your query. 
                  <button onClick={() => { setSearchQuery(''); setSelectedWarehouseFilter('ALL'); }} className="text-indigo-600 font-bold ml-1 hover:underline">
                    Clear selections
                  </button>
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
                        // Filter the stocks to only display the selected filter if applicable
                        const displayedStocks = product.stocks.filter(st => 
                          selectedWarehouseFilter === 'ALL' || st.warehouseId === selectedWarehouseFilter
                        );

                        return displayedStocks.map((st, index) => {
                          const isScarce = st.available <= 2 && st.available > 0;
                          const isNoStock = st.available === 0;

                          return (
                            <tr 
                              key={`${product.id}-${st.warehouseId}`} 
                              className={`hover:bg-slate-50/50 transition-colors ${isScarce ? 'bg-amber-50/30' : isNoStock ? 'bg-slate-100/40 opacity-75' : ''}`}
                            >
                              <td className="px-4 py-3.5">
                                {index === 0 ? (
                                  <div className="flex gap-3">
                                    <img 
                                      src={product.imageUrl} 
                                      alt={product.name} 
                                      className="w-10 h-10 object-cover rounded-md border border-slate-100 shrink-0" 
                                    />
                                    <div>
                                      <div className="font-semibold text-slate-900">{product.name}</div>
                                      <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                                        <span className="bg-slate-100 px-1 py-0.5 rounded text-indigo-700 font-bold">{product.sku}</span>
                                        <span>•</span>
                                        <span>${product.price} USD</span>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="pl-13 text-[10px] text-slate-400 italic">
                                    (Same item: {product.sku})
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="flex items-center gap-1">
                                  <MapPin className="w-3 h-3 text-slate-400" />
                                  <span className="font-semibold text-slate-800 text-[11px]">{st.warehouseName}</span>
                                </div>
                                <span className="text-[9px] text-slate-500 block pl-4">{st.warehouseLocation}</span>
                              </td>
                              <td className="px-4 py-3.5 text-center font-mono text-slate-700 font-medium">
                                {st.total}
                              </td>
                              <td className="px-4 py-3.5 text-center font-mono text-amber-600 font-medium">
                                {st.reserved > 0 ? `${st.reserved}` : '—'}
                              </td>
                              <td className="px-4 py-3.5 text-center font-mono">
                                {isNoStock ? (
                                  <span className="px-2 py-0.5 bg-red-50 text-red-700 border border-red-100 rounded-md font-bold text-[10px]">
                                    Out of Stock
                                  </span>
                                ) : isScarce ? (
                                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-md font-bold text-[10px] animate-pulse">
                                    Only {st.available} left!
                                  </span>
                                ) : (
                                  <span className="font-bold text-slate-900 text-xs">
                                    {st.available}
                                  </span>
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
                                  className={`text-xs px-3 py-1 rounded font-bold cursor-pointer transition-all ${
                                    isNoStock 
                                      ? 'text-slate-400 bg-slate-50 border border-slate-200 cursor-not-allowed'
                                      : 'text-indigo-600 hover:text-white bg-indigo-50 hover:bg-indigo-600 border border-indigo-200'
                                  }`}
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

            {/* Sidebar Active Hold Panel */}
            <div className="bg-slate-900 text-white rounded-xl shadow-lg border border-slate-800 flex flex-col p-5">
              
              {/* Header */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                  Live Cashier Terminal
                </span>
                {activeReservation ? (
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wider ${
                    activeReservation.status === 'confirmed' 
                      ? 'bg-emerald-500 text-white' 
                      : activeReservation.status === 'released' 
                      ? 'bg-slate-600 text-slate-200' 
                      : 'bg-indigo-500 text-white animate-pulse'
                  }`}>
                    {activeReservation.status.toUpperCase()}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded text-[9px] font-mono">
                    IDLE
                  </span>
                )}
              </div>

              {/* Body */}
              {!activeReservation ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-xs text-slate-400">
                  <Clock className="w-8 h-8 text-slate-600 mb-2 stroke-1" />
                  <p className="font-semibold text-slate-300">No Reserved Holding Active</p>
                  <p className="text-[10px] text-slate-500 px-4 mt-1">
                    Select a product and warehouse from the matrix to allocate secure holding units prior to checking out.
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col">
                  {/* Timer Visualizer (Only show if pending) */}
                  {activeReservation.status === 'pending' && (
                    <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-800/50 mb-4 text-center">
                      <div className="text-[10px] text-indigo-400 font-medium flex items-center justify-center gap-1.5 mb-1">
                        <Clock className="w-3 h-3 text-indigo-400 animate-spin" />
                        HOLD SECURED - EXPIRES IN
                      </div>
                      
                      <div className="text-3xl font-mono font-bold tracking-tight text-white tabular-nums leading-none mb-2">
                        {timeRemaining > 0 
                          ? `${Math.floor(timeRemaining / 60).toString().padStart(2, '0')}:${(timeRemaining % 60).toString().padStart(2, '0')}`
                          : '00:00'
                        }
                      </div>

                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-indigo-500 transition-all duration-1000 ease-linear"
                          style={{ width: `${progressPercent}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-[8px] text-slate-500 mt-1 font-mono">
                        <span>Holding units secure</span>
                        <span>{timeRemaining}s left</span>
                      </div>
                    </div>
                  )}

                  {/* Complete details block */}
                  <div className="space-y-3 p-3 bg-slate-800/20 border border-slate-800 rounded-lg text-xs leading-relaxed mb-4">
                    <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                      <span className="text-slate-400">Product</span>
                      <span className="font-semibold text-white truncate max-w-40">{activeResProductName}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                      <span className="text-slate-400">Product SKU</span>
                      <span className="font-mono text-indigo-400 font-semibold">{activeReservation.sku}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                      <span className="text-slate-400">Reserved Quantity</span>
                      <span className="font-bold text-white font-mono">{activeReservation.units}x</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                      <span className="text-slate-400">Warehouse Origin</span>
                      <span className="text-slate-200 text-right truncate max-w-36">{activeResWarehouseName}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                      <span className="text-slate-400">Created At</span>
                      <span className="text-slate-400 font-mono text-[10px]">
                        {new Date(activeReservation.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-mono text-[10px]">Reservation HOLD ID</span>
                      <span className="text-slate-400 font-mono text-[9px] uppercase tracking-wider">{activeReservation.id.substring(0, 13)}...</span>
                    </div>
                  </div>

                  {/* Transaction Actions */}
                  {activeReservation.status === 'pending' ? (
                    <div className="space-y-2 mt-auto">
                      <button
                        onClick={handleConfirmReservation}
                        disabled={isConfirming || timeRemaining <= 0}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs transition-all shadow-md active:bg-indigo-800 flex items-center justify-center gap-1 cursor-pointer"
                      >
                        {isConfirming && <RefreshCw className="w-3 h-3 animate-spin" />}
                        Confirm Purchase & Decrement Stock
                      </button>
                      <button
                        onClick={handleReleaseReservationEarly}
                        disabled={isReleasing}
                        className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg font-bold text-[11px] transition-all cursor-pointer"
                      >
                        Cancel Reservation & Early Release Units
                      </button>
                    </div>
                  ) : activeReservation.status === 'confirmed' ? (
                    <div className="mt-auto space-y-3 bg-emerald-950/20 border border-emerald-900 p-4 rounded-lg text-center animate-fadeIn">
                      <CheckCircle className="w-6 h-6 text-emerald-500 mx-auto" />
                      <div>
                        <p className="text-xs font-bold text-emerald-400">Payment Verified Successfully!</p>
                        <p className="text-[10px] text-emerald-600 mt-1">
                          Stock levels corresponding to this SKU were permanently decremented. Release locks have terminated cleanly.
                        </p>
                      </div>
                      <button
                        onClick={() => setActiveReservation(null)}
                        className="text-[10px] text-slate-400 font-bold hover:text-white underline cursor-pointer"
                      >
                        Close Confirmation Panel
                      </button>
                    </div>
                  ) : (
                    <div className="mt-auto space-y-3 bg-slate-800/40 p-4 rounded-lg text-center border border-slate-800">
                      <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 font-mono text-sm mx-auto">!</div>
                      <div>
                        <p className="text-xs font-bold text-slate-300">Reservation Released / Expired</p>
                        <p className="text-[10px] text-slate-500 mt-1">
                          Allocation expired or canceled. Holding pool has been lazy-swept back into available inventory.
                        </p>
                      </div>
                      <button
                        onClick={() => setActiveReservation(null)}
                        className="text-xs text-indigo-400 font-bold hover:text-indigo-300"
                      >
                        Dismiss Hold
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Underlay Reservation Form Modeller (Modal or Segmented control popup) */}
          {selectedProduct && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden text-xs">
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Secure Inventory Reservation Hold</h3>
                    <p className="text-slate-500 text-[11px]">Deploying transactional locking for concurrency alignment.</p>
                  </div>
                  <button 
                    onClick={() => setSelectedProduct(null)} 
                    className="text-slate-400 hover:text-slate-600 font-mono font-bold text-sm cursor-pointer px-1.5"
                  >
                    ✕
                  </button>
                </div>
                
                <div className="p-5 space-y-4">
                  <div className="flex gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
                    <img 
                      src={selectedProduct.imageUrl} 
                      alt="" 
                      className="w-12 h-12 object-cover rounded border border-slate-100"
                    />
                    <div>
                      <h4 className="font-bold text-slate-900">{selectedProduct.name}</h4>
                      <p className="text-slate-500 truncate max-w-64">{selectedProduct.description}</p>
                      <p className="font-mono text-indigo-600 mt-0.5 font-bold">{selectedProduct.sku}</p>
                    </div>
                  </div>

                  {/* Selected warehouse display */}
                  <div className="flex justify-between items-center py-2 border-b border-slate-100">
                    <span className="text-slate-500 font-medium">Fulfillment Warehouse</span>
                    <span className="font-semibold text-slate-800">
                      {warehouses.find(w => w.id === selectedWarehouseId)?.name || selectedWarehouseId}
                    </span>
                  </div>

                  {/* Quantity selector */}
                  <div className="space-y-1.5">
                    <label className="block text-slate-600 font-medium">Select Quantity to Reserve</label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setUnitsToReserve(Math.max(1, unitsToReserve - 1))}
                        className="w-8 h-8 border border-slate-300 rounded bg-slate-50 hover:bg-slate-100 font-bold font-mono cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={unitsToReserve}
                        onChange={(e) => setUnitsToReserve(Math.max(1, Number(e.target.value)))}
                        className="w-16 h-8 text-center border border-slate-300 rounded font-bold font-mono focus:ring-1 focus:ring-indigo-500 outline-hidden"
                      />
                      <button
                        onClick={() => setUnitsToReserve(unitsToReserve + 1)}
                        className="w-8 h-8 border border-slate-300 rounded bg-slate-50 hover:bg-slate-100 font-bold font-mono cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      Units are temporarily set aside for other sessions when reserved.
                    </p>
                  </div>

                  {/* Warnings if they exceed the available amount */}
                  {(() => {
                    const stockObj = selectedProduct.stocks.find(s => s.warehouseId === selectedWarehouseId);
                    const isOver = stockObj ? unitsToReserve > stockObj.available : false;
                    if (isOver) {
                      return (
                        <div className="p-2 border border-rose-200 bg-rose-50 rounded-md text-rose-800 text-[10px] flex items-center gap-1 font-medium">
                          <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                          <span>WARNING: Attempting to reserve {unitsToReserve} units but only {stockObj?.available} are currently available. This request will return a 409 Conflict status.</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 text-xs">
                  <button
                    onClick={() => setSelectedProduct(null)}
                    className="px-3.5 py-1.5 border border-slate-300 rounded-md text-slate-700 bg-white hover:bg-slate-100 font-semibold cursor-pointer"
                  >
                    Abort
                  </button>
                  <button
                    onClick={() => handleCreateReservation(selectedProduct.id, selectedWarehouseId, unitsToReserve)}
                    disabled={isReserving}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-semibold flex items-center gap-1 shadow-sm cursor-pointer"
                  >
                    {isReserving && <RefreshCw className="w-3 h-3 animate-spin" />}
                    Confirm Lock-Hold
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Section: Allo Concurrency Lab & Telemetry Monitor */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col mt-2">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center sm:flex-row flex-col gap-2">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-500" />
                <span className="font-bold text-xs text-slate-700 uppercase tracking-wider">
                  Trace Telemetry & Concurrency Sandbox
                </span>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono border">
                  Isolation: Serializable
                </span>
              </div>
              <div className="flex gap-2 text-[10px]">
                <button
                  onClick={() => setConcurrencyLog([])}
                  className="text-slate-500 hover:text-indigo-600 underline cursor-pointer"
                >
                  Clear Console Stream
                </button>
              </div>
            </div>

            <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Concurrency Laboratory Sandbox Manual Instructions */}
              <div className="lg:col-span-1 bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs leading-relaxed space-y-3">
                <div className="flex items-center gap-2 text-slate-800 font-bold">
                  <Lock className="w-4 h-4 text-indigo-500" />
                  <h4>Evaluating the Concurrency Guard</h4>
                </div>
                <p className="text-slate-600 text-[11px]">
                  Race conditions on physical stock represent a severe checkout bottleneck. Allo solves this through a thread-authoritative distributed locks pipeline.
                </p>
                
                <h5 className="font-bold text-slate-700 text-[10px] uppercase tracking-wider pt-2 border-t border-slate-200">How to prove this app is race-free:</h5>
                <ol className="list-decimal list-inside pl-1 text-slate-600 space-y-1 text-[11px]">
                  <li>
                    Look at <b>Allo Leather Backpack</b> inside the list. In <b>Austin Central Distribution</b> warehouse, it has an available count of exactly <b>1 unit</b>.
                  </li>
                  <li>
                    Click the <span className="font-semibold text-indigo-600 text-[10px]">"Trigger Parallel Race Test"</span> button in the sidebar. This deploys 2 asynchronous HTTP calls targeting this unit in exact parallel.
                  </li>
                  <li>
                    Exactly <b>one</b> shopper secures the hold (<span className="text-emerald-600 font-semibold">201 Created</span>), while the other is isolated and flatly denied (<span className="text-rose-600 font-semibold">409 Conflict</span>) to protect merchant integrity.
                  </li>
                  <li>
                    Try duplicating or reusing an <b>Idempotency-Key</b> with different quantities to check the cached safety!
                  </li>
                </ol>
              </div>

              {/* Real-time System Logs Console */}
              <div className="lg:col-span-2 bg-slate-900 rounded-lg p-3 text-white font-mono text-[10px] h-60 overflow-y-auto relative flex flex-col justify-between">
                <div className="space-y-1.5 flex-1">
                  <div className="sticky top-0 bg-slate-900 border-b border-slate-800 pb-1 flex justify-between items-center text-slate-400">
                    <span>SYSTEM TRACE OUTPUT LOGS</span>
                    <span className="text-[9px] text-emerald-500 blink animate-pulse">● STREAM LIVE</span>
                  </div>
                  
                  {concurrencyLog.length === 0 ? (
                    <div className="text-slate-500 text-center py-12">
                      Console waiting for operation telemetry. Trigger a reservation or reset database to view telemetry records...
                    </div>
                  ) : (
                    concurrencyLog.map((log) => {
                      const colorClass = 
                        log.statusType === 'success' ? 'text-emerald-400' :
                        log.statusType === 'warning' ? 'text-amber-400' :
                        log.statusType === 'error' ? 'text-rose-400' : 
                        'text-indigo-400';

                      return (
                        <div key={log.id} className="border-b border-slate-850 py-1.5 text-[11px]">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-500 font-mono text-[9px]">{log.timestamp}</span>
                            <span className={`font-semibold ${colorClass}`}>{log.status}</span>
                          </div>
                          <div className="text-slate-300 font-sans mt-0.5 font-medium">{log.action}</div>
                          <pre className="text-[9px] text-slate-400 bg-slate-950/60 p-1.5 rounded mt-1 overflow-x-auto max-h-16 font-mono font-normal">
                            {JSON.stringify(log.payload, null, 2)}
                          </pre>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Humble professional design footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2">
          <p>© 2026 Allo Retail Platform. Designed for extreme concurrency consistency.</p>
          <div className="flex gap-4 font-mono text-[10px] text-slate-400">
            <span>DATABASE: JSON FS STACK + MUTEX LOCK</span>
            <span>PORT: 3000</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
