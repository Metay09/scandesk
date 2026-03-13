import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { App as CapApp } from "@capacitor/app";
import * as XLSX from "xlsx";

import "./index.css";
import { INITIAL_USERS, INITIAL_SETTINGS, INITIAL_FIELDS, DEFAULT_CUSTS } from "./constants";
import { isNative, loadState, saveState } from "./services/storage";
import { getCurrentShift, pad2, deriveShiftDate, getShiftDate, getShiftEndTime } from "./utils";
import { normalizeRecord, migrateRecords } from "./services/recordModel";
import { sheetsUpdate, sheetsDelete, sheetsDeleteBulk, postgresApiInsert, postgresApiUpdate, postgresApiDelete, syncRecordToSheets } from "./services/integrations";
import { createQueueItem, addToQueue, removeFromQueue, getPendingItems, getRetryableItems, markAsProcessing, markAsFailed, getQueueStats } from "./services/syncQueue";
import { toDbPayload } from "./services/recordModel";
import { useToast } from "./hooks/useToast";
import { Ic, I } from "./components/Icon";
import Login from "./components/Login";
import ScanPage from "./components/ScanPage";
import DataPage from "./components/DataPage";
import ReportPage from "./components/ReportPage";
import FieldsPage from "./components/FieldsPage";
import UsersPage from "./components/UsersPage";
import SettingsPage from "./components/SettingsPage";

export default function App() {
  const [users, setUsers]         = useState(INITIAL_USERS);
  const [user, setUser]           = useState(null);
  const [page, setPage]           = useState("scan");
  const [fields, setFields]       = useState(INITIAL_FIELDS);
  const [records, setRecords]     = useState([]);
  const [lastSaved, setLastSaved] = useState(null);
  const [custList, setCustList]   = useState(DEFAULT_CUSTS);
  const [settings, setSettings]   = useState(INITIAL_SETTINGS);
  const [integration, setIntegration] = useState({
    active: false, type: "postgres_api",
    postgresApi: {
      serverUrl: "https://scandesk-api.simsekhome.site",
      apiKey: "scandesk_live_7f9c2d1a8b4e6f0c9a2d5e7b1c3f8a6d"
    },
    gsheets:  { scriptUrl: "https://script.google.com/macros/s/AKfycbywRIk85STTKY9oF9H7fu186t1WqAr26qTc_vM2w7kXd_Iq4oYpn7yu3LmPaUOHOqQj/exec" },
  });
  const [hydrated, setHydrated] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("scandesk_theme") || "dark");
  const [userLoginShift, setUserLoginShift] = useState(null);
  const [graceSecsLeft, setGraceSecsLeft] = useState(null);
  const [graceEndTime, setGraceEndTime] = useState(null); // Absolute timestamp when grace period ends
  const inGraceRef = useRef(false);
  const [shiftTakeovers, setShiftTakeovers] = useState({});
  const [logoutReason, setLogoutReason] = useState(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [syncQueue, setSyncQueue] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const backPressCountRef = useRef(0);
  const backPressTimerRef = useRef(null);

  const addShiftDate = useCallback((rec) => {
    if (!rec) return rec;
    const shiftDate = deriveShiftDate(rec);
    return shiftDate ? { ...rec, shiftDate } : { ...rec };
  }, []);

  const normalizeRecordsWithModel = useCallback((list, fieldDefs = fields) => {
    if (!Array.isArray(list)) return [];
    return migrateRecords(list, fieldDefs).map(addShiftDate);
  }, [addShiftDate, fields]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("scandesk_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  // Back button handler (3-level navigation)
  useEffect(() => {
    let listener;

    const handleBackButton = () => {
      // Clear any existing timer
      if (backPressTimerRef.current) {
        clearTimeout(backPressTimerRef.current);
      }

      backPressCountRef.current += 1;
      const pressCount = backPressCountRef.current;

      // Reset counter after 2 seconds of inactivity
      backPressTimerRef.current = setTimeout(() => {
        backPressCountRef.current = 0;
        setShowExitConfirm(false);
      }, 2000);

      // 1st press: Navigate to scan page if not already there
      if (pressCount === 1) {
        if (page !== "scan") {
          setPage("scan");
          backPressCountRef.current = 0; // Reset after navigation
        }
        return;
      }

      // 2nd press: Show exit confirmation (only on scan page)
      if (pressCount === 2 && page === "scan") {
        setShowExitConfirm(true);
        return;
      }

      // 3rd press: Exit app (only if on scan page and confirmation shown)
      if (pressCount === 3 && page === "scan" && showExitConfirm) {
        CapApp.exitApp();
        return;
      }
    };

    // Register back button listener for native apps
    CapApp.addListener('backButton', handleBackButton).then(result => {
      listener = result;
    }).catch(() => {
      // Back button not available (web browser)
      console.log('Back button listener not available - running in browser');
    });

    return () => {
      if (listener) {
        listener.remove();
      }
      if (backPressTimerRef.current) {
        clearTimeout(backPressTimerRef.current);
      }
    };
  }, [page, showExitConfirm]);

  // Load persisted state on start
  useEffect(() => {
    let alive = true;

    const normalizeLoadedRecords = (list, fieldDefs) => {
      if (!Array.isArray(list)) return [];
      return migrateRecords(list, fieldDefs).map(addShiftDate);
    };

    (async () => {
      const st = await loadState();
      if (!alive) return;

      const loadedFields =
        Array.isArray(st?.fields) && st.fields.length
          ? st.fields
          : INITIAL_FIELDS;

      const loadedUsers =
        Array.isArray(st?.users) && st.users.length
          ? st.users
          : [];

      const hasAdmin = loadedUsers.some(u => u.username === "admin");
      setUsers(hasAdmin ? loadedUsers : [INITIAL_USERS[0], ...loadedUsers]);

      if (Array.isArray(st?.fields) && st.fields.length) {
        setFields(st.fields);
      }

      if (Array.isArray(st?.records)) {
        setRecords(normalizeLoadedRecords(st.records, loadedFields));
      }

      if (st?.lastSaved) {
        const normalized = normalizeRecord(st.lastSaved, loadedFields);
        setLastSaved(addShiftDate(normalized));
      }

      if (Array.isArray(st?.custList) && st.custList.length) {
        setCustList(st.custList);
      }

      if (st?.settings) {
        setSettings(st.settings);
      }

      if (st?.integration) {
        // Migration: convert old supabase config to new postgres_api config
        let migratedIntegration = st.integration;
        if (st.integration.type === "supabase" && st.integration.supabase) {
          migratedIntegration = {
            ...st.integration,
            type: "postgres_api",
            postgresApi: {
              serverUrl: st.integration.supabase.url || "https://scandesk-api.simsekhome.site",
              apiKey: st.integration.supabase.key || "scandesk_live_7f9c2d1a8b4e6f0c9a2d5e7b1c3f8a6d"
            },
            // Keep old supabase config for reference but it won't be used
            supabase: undefined
          };
        }
        // Ensure postgresApi field exists with defaults
        if (!migratedIntegration.postgresApi) {
          migratedIntegration.postgresApi = {
            serverUrl: "https://scandesk-api.simsekhome.site",
            apiKey: "scandesk_live_7f9c2d1a8b4e6f0c9a2d5e7b1c3f8a6d"
          };
        } else {
          // Fill in defaults for empty fields (first-time setup), but preserve user values
          if (!migratedIntegration.postgresApi.serverUrl) {
            migratedIntegration.postgresApi.serverUrl = "https://scandesk-api.simsekhome.site";
          }
          if (!migratedIntegration.postgresApi.apiKey) {
            migratedIntegration.postgresApi.apiKey = "scandesk_live_7f9c2d1a8b4e6f0c9a2d5e7b1c3f8a6d";
          }
        }
        // Ensure gsheets field exists with defaults
        if (!migratedIntegration.gsheets) {
          migratedIntegration.gsheets = {
            scriptUrl: "https://script.google.com/macros/s/AKfycbywRIk85STTKY9oF9H7fu186t1WqAr26qTc_vM2w7kXd_Iq4oYpn7yu3LmPaUOHOqQj/exec"
          };
        } else {
          // Fill in default Google Sheets URL if empty
          if (!migratedIntegration.gsheets.scriptUrl) {
            migratedIntegration.gsheets.scriptUrl = "https://script.google.com/macros/s/AKfycbywRIk85STTKY9oF9H7fu186t1WqAr26qTc_vM2w7kXd_Iq4oYpn7yu3LmPaUOHOqQj/exec";
          }
        }
        setIntegration(migratedIntegration);
      }

      if (st?.shiftTakeovers && typeof st.shiftTakeovers === "object") {
        setShiftTakeovers(st.shiftTakeovers);
      }

      if (Array.isArray(st?.syncQueue)) {
        setSyncQueue(st.syncQueue);
      }

      // Restore active session if it exists and is still valid
      if (st?.activeSession) {
        const { username, loginShift } = st.activeSession;
        const foundUser = loadedUsers.find(u => u.username === username);

        if (foundUser) {
          // Check if session is still valid (shift hasn't expired beyond grace period)
          let sessionValid = true;

          if (foundUser.role !== "admin" && loginShift) {
            const currentShift = getCurrentShift();

            // If shift has changed, check if grace period has expired
            if (currentShift !== loginShift) {
              const shiftEnd = getShiftEndTime(loginShift);
              if (shiftEnd) {
                const graceEndTime = shiftEnd + (300 * 1000); // 5 minutes grace period
                const now = Date.now();
                sessionValid = now < graceEndTime;
              }
            }
          }

          if (sessionValid) {
            // Restore the user session
            setUser(foundUser);
            setUserLoginShift(loginShift);
            setPage("scan");
          } else {
            // Session expired, show logout reason
            setLogoutReason("shift_expired");
          }
        }
      }

      setHydrated(true);
    })();

    return () => {
      alive = false;
    };
  }, [addShiftDate]);

  // Persist on changes
  useEffect(() => {
    if (!hydrated) return;
    // Create activeSession object if user is logged in
    const activeSession = user ? {
      username: user.username,
      loginShift: userLoginShift,
      loginAt: new Date().toISOString()
    } : null;
    saveState({ users, fields, records, lastSaved, custList, settings, integration, shiftTakeovers, activeSession, syncQueue });
  }, [hydrated, users, fields, records, lastSaved, custList, settings, integration, shiftTakeovers, user, userLoginShift, syncQueue]);

  const { toasts, add: toast } = useToast();

  const isAdmin = user?.role === "admin";

  const visibleRecordsCount = useMemo(() => {
    if (isAdmin) return records.length;
    const currentShift = userLoginShift || getCurrentShift();
    const currentShiftDate = getShiftDate(undefined, currentShift);
    return records.filter(r =>
      r.scanned_by_username === user?.username &&
      r.shift === currentShift &&
      deriveShiftDate(r) === currentShiftDate
    ).length;
  }, [isAdmin, records, userLoginShift, user]);

  const handleLogout = useCallback((reason = null) => {
    inGraceRef.current = false;
    setUser(null);
    setPage("scan");
    setUserLoginShift(null);
    setGraceSecsLeft(null);
    setLogoutReason(reason);
  }, []);

  const handleLogin = useCallback((u) => {
    inGraceRef.current = false;
    setUser(u);
    setPage("scan");
    setGraceSecsLeft(null);
    setLogoutReason(null);
    if (u.role !== "admin") {
      setUserLoginShift(getCurrentShift());
    } else {
      setUserLoginShift(null);
    }
  }, []);

  const GRACE_PERIOD_SECS = 300; // 5 dakika

  // Vardiya bitimi algılama — sadece normal kullanıcılar için
  useEffect(() => {
    if (!user || isAdmin || !userLoginShift) return;
    const id = setInterval(() => {
      if (inGraceRef.current) return; // grace zaten başladı, gereksiz kontrol yapma
      const current = getCurrentShift();
      if (current !== userLoginShift) {
        inGraceRef.current = true;
        // Calculate absolute end time based on shift end + grace period
        const shiftEnd = getShiftEndTime(userLoginShift);
        if (shiftEnd) {
          const endTime = shiftEnd + (GRACE_PERIOD_SECS * 1000); // Add 5 minutes grace period
          setGraceEndTime(endTime);
          // Calculate initial seconds left
          const secsLeft = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
          setGraceSecsLeft(secsLeft);
        } else {
          // Fallback to old behavior if shift end can't be calculated
          setGraceSecsLeft(GRACE_PERIOD_SECS);
        }
        setPage(prev => prev === "scan" ? "data" : prev);
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [user, isAdmin, userLoginShift]);

  // Update grace seconds left based on absolute end time
  useEffect(() => {
    if (graceEndTime === null || !user) return;

    const updateRemainingTime = () => {
      const now = Date.now();
      const secsLeft = Math.max(0, Math.floor((graceEndTime - now) / 1000));

      if (secsLeft === 0) {
        handleLogout("shift_expired");
      } else {
        setGraceSecsLeft(secsLeft);
      }
    };

    // Update immediately
    updateRemainingTime();

    // Then update every second
    const id = setInterval(updateRemainingTime, 1000);
    return () => clearInterval(id);
  }, [graceEndTime, user, handleLogout]);

  const handleSave   = useCallback(r => {
    // Normalize the record to ensure it follows the new structure
    const normalized = normalizeRecord(r, fields);
    const rec = addShiftDate(normalized);
    setRecords(p => [rec, ...p]);
    setLastSaved(rec);
  }, [addShiftDate, fields]);
  const handleSyncUpdate = useCallback((id, success = true, error = null) => {
    setRecords(p => p.map(r => {
      if (r.id !== id) return r;
      return {
        ...r,
        syncStatus: success ? "synced" : "failed",
        syncError: error || ""
      };
    }));
  }, []);
  const handleDelete = (idOrIds) => {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    const idSet = new Set(ids);
    const deletedRecords = records.filter(r => idSet.has(r.id));
    setRecords(p => p.filter(r => !idSet.has(r.id)));
    setLastSaved(p => (p && idSet.has(p.id) ? null : p));
    toast(ids.length === 1 ? "Kayıt silindi" : `${ids.length} kayıt silindi`, "var(--err)");

    // Sync deletions to PostgreSQL if integration is active
    if (integration.active && integration.type === "postgres_api") {
      ids.forEach(id => {
        const record = deletedRecords.find(r => r.id === id);
        postgresApiDelete(integration.postgresApi, id)
          .catch(err => {
            if (record) addToSyncQueue("delete", id, record);
          });
      });
    }

    // Sync deletions to Google Sheets if integration is active
    if (integration.active && integration.type === "gsheets") {
      sheetsDeleteBulk(integration.gsheets, ids)
        .catch(e => console.error("Sheets silme hatası:", e));
    }
  };
  const handleEdit   = r  => {
    // Normalize the edited record
    const normalized = normalizeRecord(r, fields);
    const rec = addShiftDate(normalized);
    // Update the updatedAt timestamp
    rec.updatedAt = new Date().toISOString();
    setRecords(p => p.map(x => x.id === rec.id ? rec : x));
    toast("Güncellendi", "var(--inf)");

    // Sync update to PostgreSQL if integration is active
    if (integration.active && integration.type === "postgres_api") {
      // Try to sync immediately
      const dbPayload = toDbPayload(rec);
      postgresApiUpdate(integration.postgresApi, rec.id, dbPayload)
        .then(() => {
          // Success
          handleSyncUpdate?.(rec.id, true, null);
        })
        .catch(err => {
          // Failed - add to queue for retry
          handleSyncUpdate?.(rec.id, false, err.message);
          addToSyncQueue("update", rec.id, rec);
          toast("PostgreSQL güncelleme başarısız, kuyruğa eklendi", "var(--acc)");
        });
    }

    // Sync update to Google Sheets if integration is active
    if (integration.active && integration.type === "gsheets") {
      const ef = fields.filter(f => f.id !== "barcode");
      const headers = ["Barkod", ...ef.map(f => f.label), "Müşteri", "Açıklama", "Kaydeden", "Kullanıcı Adı", "Tarih", "Saat"];
      // Flatten customFields for sync payload - id is first element
      const timestamp = new Date(rec.timestamp);
      const rowArr = [
        rec.id,
        rec.barcode,
        ...ef.map(f => rec.customFields?.[f.id] ?? ""),
        rec.customer,
        rec.aciklama,
        rec.scanned_by,
        rec.scanned_by_username,
        timestamp.toLocaleDateString("tr-TR"),
        timestamp.toLocaleTimeString("tr-TR")
      ];

      // Note: no-cors fetch returns opaque response - cannot detect server errors
      // Apps Script will update the existing row with matching id
      sheetsUpdate(integration.gsheets, headers, rowArr)
        .then(() => {
          // Request sent successfully (but server response unknown due to no-cors)
          // Don't update sync status for Google Sheets
        })
        .catch(e => {
          // Network error or request failed to send
          toast("Sheets güncelleme hatası: " + e.message, "var(--err)");
        });
    }
  };

  // Add to PostgreSQL sync queue
  const addToSyncQueue = useCallback((action, recordId, payload) => {
    const item = createQueueItem(action, recordId, payload);
    setSyncQueue(prev => addToQueue(prev, item));
  }, []);

  // Process sync queue - sync pending items to PostgreSQL
  const processSyncQueue = useCallback(async () => {
    if (!integration.active || integration.type !== "postgres_api") {
      toast("PostgreSQL entegrasyonu aktif değil", "var(--err)");
      return { success: 0, failed: 0 };
    }

    if (isSyncing) {
      toast("Senkronizasyon zaten devam ediyor", "var(--acc)");
      return { success: 0, failed: 0 };
    }

    // Get retryable items (pending + failed)
    const retryable = getRetryableItems(syncQueue);
    if (retryable.length === 0) {
      toast("Bekleyen işlem yok", "var(--acc)");
      return { success: 0, failed: 0 };
    }

    setIsSyncing(true);
    let successCount = 0;
    let failedCount = 0;
    let retriedCount = 0;

    for (const item of retryable) {
      try {
        // Track if this was a retry
        const wasRetry = item.status === "failed";

        // Mark as processing
        setSyncQueue(prev => markAsProcessing(prev, item.id));

        // Execute the sync operation
        if (item.action === "create") {
          const dbPayload = toDbPayload(item.payload);
          await postgresApiInsert(integration.postgresApi, dbPayload);
          // Update record sync status to synced
          handleSyncUpdate(item.recordId, true, null);
        } else if (item.action === "update") {
          const dbPayload = toDbPayload(item.payload);
          await postgresApiUpdate(integration.postgresApi, item.recordId, dbPayload);
          // Update record sync status to synced
          handleSyncUpdate(item.recordId, true, null);
        } else if (item.action === "delete") {
          await postgresApiDelete(integration.postgresApi, item.recordId);
          // Record already deleted locally, no need to update
        }

        // Success - remove from queue
        setSyncQueue(prev => removeFromQueue(prev, item.id));
        successCount++;
        if (wasRetry) retriedCount++;
      } catch (err) {
        // Failed - mark as failed in queue
        setSyncQueue(prev => markAsFailed(prev, item.id, err.message));
        // Update record sync status to failed
        if (item.action !== "delete") {
          handleSyncUpdate(item.recordId, false, err.message);
        }
        failedCount++;
      }
    }

    setIsSyncing(false);

    // Show detailed result
    if (failedCount === 0 && retriedCount === 0) {
      toast(`${successCount} işlem senkronize edildi`, "var(--ok)");
    } else if (failedCount === 0 && retriedCount > 0) {
      toast(`${successCount} işlem senkronize edildi (${retriedCount} yeniden denendi)`, "var(--ok)");
    } else if (successCount > 0 && failedCount > 0) {
      toast(`${successCount} başarılı, ${failedCount} başarısız${retriedCount > 0 ? ` (${retriedCount} yeniden denendi)` : ""}`, "var(--err)");
    } else {
      toast(`Tümü başarısız: ${failedCount} hata`, "var(--err)");
    }

    return { success: successCount, failed: failedCount, retried: retriedCount };
  }, [integration, isSyncing, syncQueue, handleSyncUpdate, toast]);

  const handleClear  = () => {
    if (window.confirm("Tüm kayıtlar silinecek. Onaylıyor musunuz?")) {
      const recordsToDelete = [...records]; // Copy current records before clearing
      setRecords([]);
      setLastSaved(null);
      toast("Tüm veriler temizlendi", "var(--err)");

      // Sync each deletion to PostgreSQL if integration is active
      if (integration.active && integration.type === "postgres_api") {
        recordsToDelete.forEach(record => {
          postgresApiDelete(integration.postgresApi, record.id)
            .catch(err => {
              // Failed - add to queue for retry
              addToSyncQueue("delete", record.id, record);
            });
        });
        if (recordsToDelete.length > 0) {
          toast(`PostgreSQL'den ${recordsToDelete.length} kayıt siliniyor...`, "var(--acc)");
        }
      }

      // Sync each deletion to Google Sheets if integration is active
      if (integration.active && integration.type === "gsheets") {
        recordsToDelete.forEach(record => {
          sheetsDelete(integration.gsheets, record.id)
            .catch(e => {
              // Network error - just log it
              console.error("Sheets silme hatası:", e);
            });
        });
        if (recordsToDelete.length > 0) {
          toast(`Google Sheets'den ${recordsToDelete.length} kayıt siliniyor...`, "var(--acc)");
        }
      }
    }
  };

  const handleDeleteRange = (startLocal, endLocal) => {
    const a = new Date(startLocal).toISOString();
    const b = new Date(endLocal).toISOString();

    // Find records to delete before filtering
    const recordsToDelete = records.filter(r => r.timestamp >= a && r.timestamp <= b);

    // Update local state
    setRecords(p => p.filter(r => !(r.timestamp >= a && r.timestamp <= b)));
    setLastSaved(p => (p && (p.timestamp >= a && p.timestamp <= b) ? null : p));

    // Sync each deletion to PostgreSQL if integration is active
    if (integration.active && integration.type === "postgres_api") {
      recordsToDelete.forEach(record => {
        postgresApiDelete(integration.postgresApi, record.id)
          .catch(err => {
            // Failed - add to queue for retry
            addToSyncQueue("delete", record.id, record);
          });
      });
      if (recordsToDelete.length > 0) {
        toast(`PostgreSQL'den ${recordsToDelete.length} kayıt siliniyor...`, "var(--acc)");
      }
    }

    // Sync each deletion to Google Sheets if integration is active
    if (integration.active && integration.type === "gsheets") {
      recordsToDelete.forEach(record => {
        sheetsDelete(integration.gsheets, record.id)
          .catch(e => {
            // Network error - just log it
            console.error("Sheets silme hatası:", e);
          });
      });
      if (recordsToDelete.length > 0) {
        toast(`Google Sheets'den ${recordsToDelete.length} kayıt siliniyor...`, "var(--acc)");
      }
    }
  };

  const handleExport = async (type, ids) => {
    const recs = Array.isArray(ids) && ids.length ? records.filter(r => ids.includes(r.id)) : records;
    if (!recs.length) { toast("Dışa aktarılacak kayıt yok", "var(--acc)"); return; }
    const ef = fields.filter(f => f.id !== "barcode");

    // Export includes system fields for full data preservation
    const hdr = [
      "ID", "Barkod", "Müşteri", "Açıklama", "Kaydeden", "Kullanıcı Adı",
      "Tarih", "Saat", "Vardiya",
      "Kaynak", "Kaynak Kayıt ID", "Güncellenme", "Senkronizasyon Durumu", "Senkronizasyon Hatası",
      ...ef.map(f => f.label)
    ];

    // Helper to safely get field value while preserving data types
    const safeValue = (val) => {
      if (val == null) return "";
      // Preserve primitives (string, number, boolean) as-is for Excel
      if (typeof val !== "object") return val;
      // Convert objects/arrays to JSON string as fallback
      return JSON.stringify(val);
    };

    // Helper to get field value from record (supports both customFields and root level)
    const getFieldValue = (record, fieldId) => {
      // Check customFields first
      if (record.customFields && fieldId in record.customFields) {
        return record.customFields[fieldId];
      }
      // Fallback to root level
      return record[fieldId];
    };

    const data = recs.map(r => {
      try {
        const d = new Date(r.timestamp);
        const isValidDate = !Number.isNaN(d.getTime());

        // Use local time for date/time display
        // date: YYYY-MM-DD (local)
        // time: HH:MM:SS (local)
        const pad = (n) => String(n).padStart(2, '0');
        const dateOut = isValidDate ? `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` : "";
        const timeOut = isValidDate ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : "";

        return [
          safeValue(r.id),
          safeValue(r.barcode),
          safeValue(r.customer),
          safeValue(r.aciklama),
          safeValue(r.scanned_by),
          safeValue(r.scanned_by_username),
          dateOut,
          timeOut,
          safeValue(r.shift),
          safeValue(r.source),
          safeValue(r.sourceRecordId),
          safeValue(r.updatedAt),
          safeValue(r.syncStatus),
          safeValue(r.syncError),
          ...ef.map(f => safeValue(getFieldValue(r, f.id)))
        ];
      } catch (err) {
        console.error("Error processing record:", r, err);
        // Return a row with error indicator
        return [
          safeValue(r.barcode),
          ...ef.map(() => ""),
          "",
          "",
          "",
          "",
          ""
        ];
      }
    });
    if (type === "xlsx") {
      try {
        const ws = XLSX.utils.aoa_to_sheet([hdr, ...data]);
        ws["!cols"] = hdr.map(() => ({ wch: 20 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Taramalar");
        const filename = `scandesk_${new Date().toISOString().slice(0, 10)}.xlsx`;

        if (isNative()) {
          const b64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
          await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache });
          await Share.share({ title: "ScanDesk Excel", text: "Excel dosyası hazır", url: (await Filesystem.getUri({ directory: Directory.Cache, path: filename })).uri });
          toast("Excel hazır (Paylaş)", "var(--ok)");
        } else {
          XLSX.writeFile(wb, filename);
          toast("Excel indirildi", "var(--ok)");
        }
      } catch (err) {
        console.error("Excel export error:", err);
        toast("Excel dışa aktarma hatası: " + (err?.message || err), "var(--err)");
      }
    } else {
      try {
        const csv = [hdr, ...data].map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
        const filename = `scandesk_${Date.now()}.csv`;
        if (isNative()) {
          await Filesystem.writeFile({ path: filename, data: "\uFEFF" + csv, directory: Directory.Cache, encoding: Encoding.UTF8 });
          await Share.share({ title: "ScanDesk CSV", text: "CSV dosyası hazır", url: (await Filesystem.getUri({ directory: Directory.Cache, path: filename })).uri });
          toast("CSV hazır (Paylaş)", "var(--ok)");
        } else {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
          a.download = filename;
          a.click();
          toast("CSV indirildi", "var(--ok)");
        }
      } catch (err) {
        console.error("CSV export error:", err);
        toast("CSV dışa aktarma hatası: " + (err?.message || err), "var(--err)");
      }
    }
  };

  const handleImport = async (imported) => {
    if (!imported.length) { toast("İçe aktarılacak veri yok", "var(--acc)"); return; }
    // Migrate imported records to new structure
    const normalized = normalizeRecordsWithModel(imported);
    setRecords(p => [...normalized, ...p]);
    toast(`✓ ${normalized.length} kayıt içe aktarıldı`, "var(--ok)");

    // Sync each imported record to integrations (same logic as new scans)
    if (integration.active && normalized.length > 0) {
      let syncedCount = 0;
      let failedCount = 0;

      for (const record of normalized) {
        // PostgreSQL integration
        if (integration.type === "postgres_api") {
          try {
            const dbPayload = toDbPayload(record);
            await postgresApiInsert(integration.postgresApi, dbPayload);
            // Success: mark as synced
            handleSyncUpdate(record.id, true, null);
            syncedCount++;
          } catch (e) {
            // Failure: mark as failed with error and add to queue
            handleSyncUpdate(record.id, false, e.message);
            addToSyncQueue("create", record.id, record);
            failedCount++;
          }
        }
        // Google Sheets integration
        else if (integration.type === "gsheets") {
          try {
            await syncRecordToSheets(integration.gsheets, record, fields);
            syncedCount++;
          } catch (e) {
            // Network error - just log it (can't detect server errors due to no-cors)
            console.error("Sheets sync error on import:", e);
            failedCount++;
          }
        }
      }

      // Show sync result
      if (integration.type === "postgres_api") {
        if (failedCount === 0) {
          toast(`${syncedCount} kayıt PostgreSQL'e senkronize edildi`, "var(--ok)");
        } else {
          toast(`${syncedCount} senkronize, ${failedCount} başarısız (kuyruğa eklendi)`, "var(--acc)");
        }
      } else if (integration.type === "gsheets") {
        toast(`${normalized.length} kayıt Google Sheets'e gönderildi`, "var(--ok)");
      }
    }
  };

  const customers = {
    list: custList,
    add:    name => { if (!custList.includes(name)) setCustList(p => [...p, name]); },
    remove: name => setCustList(p => p.filter(c => c !== name)),
  };

  const NAV = [
    { id: "scan",     label: "Tara",      icon: I.scan },
    { id: "data",     label: "Veriler",   icon: I.data },
    { id: "report",   label: "Rapor",     icon: I.report },
    { id: "fields",   label: "Alanlar",   icon: I.fields },
    { id: "users",    label: "Kullanıcı", icon: I.users,    adminOnly: true },
    { id: "settings", label: "Ayarlar",   icon: I.settings },
  ].filter(n => !n.adminOnly || isAdmin);

  const handleMigratePassword = (userId, hashed) => {
    setUsers(p => p.map(u => u.id === userId ? { ...u, password: hashed } : u));
  };

  const handleShiftTakeover = useCallback((shift, date) => {
    if (!user) return;
    const key = `${date}_${shift}`;
    setShiftTakeovers(p => ({
      ...p,
      [key]: { user: user.name, userId: user.id, ts: new Date().toISOString() },
    }));
  }, [user]);

  if (!hydrated) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 12, color: "var(--tx2)" }}>
      <div style={{ width: 36, height: 36, border: "3px solid var(--brd)", borderTopColor: "var(--acc)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <span style={{ fontSize: 13 }}>Yükleniyor...</span>
    </div>
  );

  if (!user) return <Login users={users} onLogin={handleLogin} onMigratePassword={handleMigratePassword} logoutReason={logoutReason} />;

  return (
    <div className="shell">
      {/* TOPBAR (mobile) */}
      <div className="topbar">
        <div className="logo-icon" style={{ width: 28, height: 28, borderRadius: 7 }}><Ic d={I.barcode} s={14} /></div>
        <span style={{ fontSize: 15, fontWeight: 800 }}>ScanDesk</span>
        {integration.active && integration.type === "postgres_api" && (
          <button
            className="btn btn-ghost btn-sm"
            style={{
              width: 36,
              height: 36,
              padding: 0,
              flexShrink: 0,
              position: "relative"
            }}
            onClick={processSyncQueue}
            disabled={isSyncing}
            title="Bekleyenleri senkronize et"
          >
            <Ic
              d={I.refresh}
              s={16}
              style={{
                animation: isSyncing ? "spin 1s linear infinite" : "none"
              }}
            />
            {getRetryableItems(syncQueue).length > 0 && (
              <span style={{
                position: "absolute",
                top: 2,
                right: 2,
                background: "var(--err)",
                color: "#fff",
                fontSize: 9,
                fontWeight: 700,
                borderRadius: "50%",
                width: 14,
                height: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                {getRetryableItems(syncQueue).length}
              </span>
            )}
          </button>
        )}
        <span style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 700, color: "var(--tx2)" }}>
          {NAV.find(n => n.id === page)?.label}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          style={{ width: 36, height: 36, padding: 0, flexShrink: 0 }}
          onClick={toggleTheme}
          title={theme === "dark" ? "Açık tema" : "Koyu tema"}
        >
          <Ic d={theme === "dark" ? I.sun : I.moon} s={16} />
        </button>
        <div className="user-pill">
          <div className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>{user.name[0]}</div>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{user.name}</span>
          {isAdmin && <span className="badge badge-acc">ADM</span>}
        </div>
      </div>

      {/* SIDEBAR (desktop) */}
      <div className="side-nav">
        <div className="side-logo">
          <div className="logo-icon" style={{ width: 30, height: 30, borderRadius: 8 }}><Ic d={I.barcode} s={14} /></div>
          ScanDesk
          {integration.active && integration.type === "postgres_api" && (
            <button
              className="btn btn-ghost btn-sm"
              style={{
                width: 32,
                height: 32,
                padding: 0,
                marginLeft: "auto",
                flexShrink: 0,
                position: "relative"
              }}
              onClick={processSyncQueue}
              disabled={isSyncing}
              title="Bekleyenleri senkronize et"
            >
              <Ic
                d={I.refresh}
                s={14}
                style={{
                  animation: isSyncing ? "spin 1s linear infinite" : "none"
                }}
              />
              {getRetryableItems(syncQueue).length > 0 && (
                <span style={{
                  position: "absolute",
                  top: 1,
                  right: 1,
                  background: "var(--err)",
                  color: "#fff",
                  fontSize: 9,
                  fontWeight: 700,
                  borderRadius: "50%",
                  width: 14,
                  height: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>
                  {getRetryableItems(syncQueue).length}
                </span>
              )}
            </button>
          )}
        </div>
        {NAV.map(n => (
          <button key={n.id} className={`side-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
            <Ic d={n.icon} s={15} />{n.label}
            {n.id === "data" && visibleRecordsCount > 0 && <span className="nav-badge" style={{ marginLeft: "auto" }}>{visibleRecordsCount}</span>}
            {n.id === "settings" && integration.active && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)", marginLeft: "auto" }} />}
          </button>
        ))}
        <div className="side-footer">
          <div className="user-pill" style={{ borderRadius: "var(--r)", gap: 8 }}>
            <div className="avatar" style={{ width: 30, height: 30 }}>{user.name[0]}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{user.name}</div>
              <div style={{ fontSize: 10, color: "var(--tx2)" }}>@{user.username} · {isAdmin ? "Admin" : "Kullanıcı"}</div>
            </div>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="scroll-area">
        {page === "scan"     && <ScanPage fields={fields} onSave={handleSave} onEdit={handleEdit} onSyncUpdate={handleSyncUpdate} records={records} lastSaved={lastSaved} customers={customers} isAdmin={isAdmin} user={user} integration={integration} scanSettings={settings} toast={toast} shiftExpired={graceSecsLeft !== null && !isAdmin} shiftTakeovers={shiftTakeovers} onShiftTakeover={handleShiftTakeover} addToSyncQueue={addToSyncQueue} />}
        {page === "data"     && <DataPage     fields={fields} records={records} onDelete={handleDelete} onEdit={handleEdit} onExport={handleExport} onImport={handleImport} customers={customers} settings={settings} toast={toast} isAdmin={isAdmin} currentShift={userLoginShift || getCurrentShift()} user={user} integration={integration} onSyncUpdate={handleSyncUpdate} syncQueue={syncQueue} isSyncing={isSyncing} onProcessSyncQueue={processSyncQueue} />}
        {page === "report"   && <ReportPage   records={records} fields={fields} isAdmin={isAdmin} currentShift={userLoginShift || getCurrentShift()} />}
        {page === "fields"   && <FieldsPage   fields={fields} setFields={setFields} isAdmin={isAdmin} settings={settings} />}
        {page === "users"    && isAdmin && <UsersPage users={users} setUsers={setUsers} currentUser={user} toast={toast} />}
        {page === "settings" && <SettingsPage settings={settings} setSettings={setSettings} integration={integration} setIntegration={setIntegration} isAdmin={isAdmin} onClearData={handleClear} onDeleteRange={handleDeleteRange} records={records} toast={toast} user={user} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} />}
      </div>

      {/* BOTTOM NAV (mobile) */}
      <nav className="bot-nav">
        {NAV.map(n => (
          <button key={n.id} className={`nav-btn ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
            <Ic d={n.icon} s={21} />{n.label}
            {n.id === "data" && visibleRecordsCount > 0 && <span className="nav-badge">{visibleRecordsCount}</span>}
          </button>
        ))}
      </nav>

      {/* GRACE PERIOD BANNER */}
      {graceSecsLeft !== null && !isAdmin && (
        <div style={{
          position: "fixed", bottom: 56, left: 0, right: 0, zIndex: 9000,
          background: "var(--err)", color: "#fff",
          padding: "10px 16px", display: "flex", alignItems: "center",
          gap: 10, fontSize: 13, fontWeight: 700,
          boxShadow: "0 -2px 12px rgba(0,0,0,.4)"
        }}>
          <Ic d={I.lock} s={16} />
          <span style={{ flex: 1 }}>
            Vardiya süresi doldu — çıkışa {Math.floor(graceSecsLeft / 60)}:{pad2(graceSecsLeft % 60)} kaldı
          </span>
          <button
            className="btn btn-sm"
            style={{ background: "rgba(255,255,255,.2)", color: "#fff", border: "1px solid rgba(255,255,255,.4)" }}
            onClick={handleLogout}
          >
            <Ic d={I.logout} s={14} /> Çıkış Yap
          </button>
        </div>
      )}

      {/* EXIT CONFIRMATION MODAL */}
      {showExitConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10000,
          background: "rgba(0,0,0,.7)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 20
        }}>
          <div style={{
            background: "var(--card)", borderRadius: "var(--r)",
            border: "1.5px solid var(--brd)", padding: 20,
            maxWidth: 360, width: "100%",
            boxShadow: "0 8px 32px rgba(0,0,0,.4)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <Ic d={I.warning} s={20} />
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Uygulamadan Çık</h3>
            </div>
            <p style={{ fontSize: 14, color: "var(--tx2)", marginBottom: 20 }}>
              Uygulamayı kapatmak istediğinizden emin misiniz? Geri tuşuna bir kez daha basın.
            </p>
            <button
              className="btn btn-ghost btn-full"
              onClick={() => {
                setShowExitConfirm(false);
                backPressCountRef.current = 0;
              }}
            >
              İptal
            </button>
          </div>
        </div>
      )}

      {/* TOASTS */}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className="toast" style={{ borderColor: t.color, color: t.color }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
