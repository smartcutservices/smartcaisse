import { adminCheckAuth, adminCheckDb, adminCheckReadyPromise, auth, authReadyPromise, db } from './firebase-init.js?v=20260801-45';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const APP_VERSION = '20260802-4';
const LOCATION_COLLECTION = 'smartManagementLocations';
const PRODUCT_COLLECTION = 'products';
const CATEGORY_COLLECTION = 'categories_list';
const CLIENT_COLLECTION = 'clients';
const STOCK_BALANCE_COLLECTION = 'smartManagementStockBalances';
const STOCK_MOVEMENT_COLLECTION = 'smartManagementStockMovements';
const STOCK_TRANSFER_COLLECTION = 'smartManagementStockTransfers';
const CASH_SESSION_COLLECTION = 'smartManagementCashSessions';
const CASH_SALE_COLLECTION = 'smartManagementPosSales';
const STOCK_OPERATION_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/smartManagementStockOperation';
const ALLOWED_ROLES = new Set(['admin', 'manager', 'stock_manager', 'caissier']);
const ROLE_ALIASES = {
  responsable: 'manager',
  gestionnaire: 'manager',
  store_manager: 'manager',
  manager_store: 'manager',
  cashier: 'caissier',
  caissiere: 'caissier',
  caissière: 'caissier',
  stock: 'stock_manager',
  responsable_stock: 'stock_manager',
  inventory_manager: 'stock_manager',
  administrateur: 'admin',
};
const MANAGER_VIEWS = new Set(['manager-overview', 'manager-sales', 'manager-stock', 'manager-reports', 'manager-sessions']);
const STOCK_VIEWS = new Set(['stock-overview', 'stock-inventory', 'stock-products', 'stock-movements', 'stock-transfers', 'stock-physical', 'stock-locations', 'stock-reports']);

const root = document.getElementById('app');
const state = {
  user: null,
  profile: null,
  locations: [],
  products: [],
  categories: [],
  clients: [],
  balances: [],
  movements: [],
  transfers: [],
  sessions: [],
  sales: [],
  selectedLocationId: '',
  activeCategory: 'all',
  search: '',
  cart: [],
  selectedClientId: '',
  customerName: '',
  customerPhone: '',
  clientSearch: '',
  keypadBuffer: '',
  paymentMethod: 'cash',
  discountType: 'percent',
  discount: 0,
  amountPaid: 0,
  lastSale: null,
  notice: null,
  closeSessionModal: false,
  closingAmount: '',
  discountModalOpen: false,
  discountAuthorized: false,
  discountAdminEmail: '',
  discountRequested: '',
  discountAuthError: '',
  sidebarCollapsed: false,
  activeView: 'register',
  managerLocationId: 'all',
  managerPeriod: '30',
  managerSearch: '',
  stockPeriod: '30',
  stockSearch: '',
  loading: false,
};

function icon(name, className = '') {
  return `<i data-lucide="${name}" class="${className}" aria-hidden="true"></i>`;
}

function refreshIcons() {
  requestAnimationFrame(() => window.lucide?.createIcons?.());
}

function setupButtonClickSound() {
  if (document.documentElement.dataset.buttonClickSoundReady === 'true') return;
  document.documentElement.dataset.buttonClickSoundReady = 'true';

  const clickSound = './assets/click.mp3';
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('button');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;

    // Clone the short sound so quick consecutive clicks each get feedback.
    const audio = new Audio(clickSound);
    audio.volume = 0.18;
    audio.play().catch(() => {
      // Browsers may reject audio until a user gesture has been registered.
    });
  }, true);
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return `${Math.round(toNumber(value)).toLocaleString('fr-FR')} HTG`;
}

function formatPaymentMethod(value = '') {
  return ({
    cash: 'Liquide',
  })[value] || 'Liquide';
}

function formatDate(value) {
  if (!value) return '-';
  const date = value?.toDate?.() || new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatClockLabel(value = new Date()) {
  return value.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function makeId(prefix) {
  if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function safeDocs(ref, fallback = [], label = 'collection') {
  try {
    const snap = await getDocs(ref);
    return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  } catch (error) {
    console.warn(`[SMART_CAISSE] Lecture indisponible: ${label}`, {
      code: error?.code || '',
      message: error?.message || String(error),
    });
    return fallback;
  }
}

function getRole(profile = {}) {
  const rawRole = String(profile.role || profile.smartRole || '').trim().toLowerCase();
  return ROLE_ALIASES[rawRole] || rawRole;
}

function canUseCaisse(profile = {}) {
  const role = getRole(profile);
  if (String(profile.status || '').toLowerCase() === 'inactive') return false;
  return ALLOWED_ROLES.has(role) || profile.smartManagementAccess === true || profile.dashboardAccess === true;
}

function getDisplayName() {
  return state.profile?.name || state.profile?.displayName ||
    [state.profile?.firstName || state.profile?.prenom, state.profile?.lastName || state.profile?.nom]
      .filter(Boolean).join(' ') ||
    state.profile?.username || state.user?.displayName || state.user?.email || 'Utilisateur';
}

function isManager() {
  return getRole(state.profile || {}) === 'manager';
}

function isStockManager() {
  return getRole(state.profile || {}) === 'stock_manager';
}

function isBackOfficeRole() {
  return isManager() || isStockManager();
}

function getProductName(product = {}) {
  return product.name || product.title || product.productName || 'Produit sans nom';
}

function getProductStatus(product = {}) {
  const status = String(product.status || '').toLowerCase();
  if (status === 'inactive' || product.active === false || product.isActive === false) return 'inactive';
  return 'active';
}

function getProductVisibility(product = {}) {
  if (['both', 'pos', 'website', 'hidden'].includes(product.visibility)) return product.visibility;
  const website = product.visibleOnWebsite !== false && product.websiteVisible !== false;
  const pos = product.visibleOnPos !== false && product.posVisible !== false;
  if (website && pos) return 'both';
  if (website) return 'website';
  if (pos) return 'pos';
  return 'hidden';
}

function isVisibleInStore(product = {}) {
  const visibility = getProductVisibility(product);
  return visibility === 'both' || visibility === 'pos';
}

function getProductImage(product = {}, balance = {}) {
  const images = Array.isArray(product.images) ? product.images : [];
  return balance.image || product.image || product.imageUrl || product.mainImage || images[0] || '';
}

function getCategoryLabel(value = '') {
  if (value && typeof value === 'object') {
    return normalizeText(value.name || value.label || value.title || value.categoryName || value.id || '');
  }
  return normalizeText(value);
}

function resolveCategoryLabel(value = '') {
  const label = getCategoryLabel(value);
  if (!label) return '';
  const category = state.categories.find((entry) => entry.id === label);
  return getCategoryLabel(category?.name || category?.label || category?.title) || label;
}

function getProductCategory(product = {}, balance = {}) {
  const categoryValues = [
    balance.categoryName,
    balance.category,
    product.categoryName,
    product.category,
    product.mainCategory,
    product.department,
    product.categoryId,
    ...(Array.isArray(product.categories) ? product.categories : []),
  ];
  for (const value of categoryValues) {
    const resolved = resolveCategoryLabel(value);
    if (resolved) return resolved;
  }
  return 'Sans catégorie';
}

function getCategorySlug(value = '') {
  return normalizeText(value).toLowerCase() || 'sans-categorie';
}

function readPositiveNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function getProductVariants(product = {}) {
  const source = Array.isArray(product.variants) ? product.variants
    : Array.isArray(product.variations) ? product.variations
      : [];
  return source.map((variant, index) => ({
    ...variant,
    id: String(variant.id || variant.variantId || variant.sku || `variant-${index + 1}`),
    label: normalizeText(variant.label || variant.name || variant.title || variant.optionLabel || `Variante ${index + 1}`),
  }));
}

function getProductStock(product = {}) {
  return readPositiveNumber(
    product.availableQty,
    product.physicalQty,
    product.stock,
    product.totalStock,
    product.stockTotal,
    product.quantity,
    product.qty
  );
}

function getVariantStock(variant = {}) {
  return readPositiveNumber(
    variant.availableQty,
    variant.physicalQty,
    variant.stock,
    variant.totalStock,
    variant.quantity,
    variant.qty
  );
}

function getProductSalePrice(product = {}, variant = {}) {
  return readPositiveNumber(
    variant.salePrice,
    variant.price,
    variant.specificPrice,
    variant.prix,
    product.salePrice,
    product.price,
    product.basePrice,
    product.prix
  );
}

function getProductUnitCost(product = {}, variant = {}) {
  return readPositiveNumber(
    variant.unitCost,
    variant.purchasePrice,
    variant.costPrice,
    variant.buyingPrice,
    product.unitCost,
    product.purchasePrice,
    product.costPrice,
    product.buyingPrice
  );
}

function getVariantImage(product = {}, variant = {}) {
  const variantImages = Array.isArray(variant.images) ? variant.images : [];
  return variant.image || variant.imageUrl || variant.mainImage || variantImages[0] || getProductImage(product);
}

function isDigitalProduct(product = {}) {
  const type = String(product.productType || product.type || '').toLowerCase();
  return product.isDigital === true || product.digital === true || product.digitalProduct === true || type === 'digital';
}

function getCatalogCategories() {
  const categories = new Map();
  getAllCatalogItems({ applyFilters: false }).forEach((item) => {
    const label = item.category || 'Sans categorie';
    categories.set(getCategorySlug(label), label);
  });
  return [...categories.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function getClientName(client = {}) {
  return normalizeText(
    client.fullName ||
    client.displayName ||
    client.name ||
    [client.firstName || client.prenom, client.lastName || client.nom].filter(Boolean).join(' ') ||
    client.username ||
    client.email ||
    ''
  );
}

function getClientPhone(client = {}) {
  return normalizeText(client.phone || client.telephone || client.whatsapp || client.mobile || '');
}

function getFilteredClients(max = 8) {
  const search = normalizeText(state.clientSearch || '').toLowerCase();
  return state.clients
    .filter((client) => {
      const haystack = [
        getClientName(client),
        client.email,
        getClientPhone(client),
      ].filter(Boolean).join(' ').toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort((a, b) => getClientName(a).localeCompare(getClientName(b)))
    .slice(0, max);
}

function getActiveLocations() {
  return state.locations.filter((location) => {
    const status = String(location.status || 'active').toLowerCase();
    const kind = location.kind || location.type || 'store';
    return status === 'active' && (kind === 'store' || kind === 'warehouse');
  });
}

function getSelectedLocation() {
  return getActiveLocations().find((location) => location.id === state.selectedLocationId) || getActiveLocations()[0] || null;
}

function getOpenSession() {
  const selected = getSelectedLocation();
  if (!selected) return null;
  return state.sessions.find((session) => {
    const status = String(session.status || 'open').toLowerCase();
    return status !== 'closed' && session.locationId === selected.id;
  }) || null;
}

async function ensureAutomaticSession() {
  const selected = getSelectedLocation();
  if (!selected || !state.user) return null;

  const existing = getOpenSession();
  if (existing) return existing;

  const sessionId = makeId('cash-session');
  const openedAt = new Date().toISOString();
  const session = {
    id: sessionId,
    reference: `SESSION-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${sessionId.slice(-5).toUpperCase()}`,
    status: 'open',
    locationId: selected.id,
    locationName: selected.name || 'Emplacement principal',
    openingFloat: 0,
    totalSales: 0,
    saleCount: 0,
    openedBy: state.user.uid,
    openedByName: getDisplayName(),
    openedAt,
    autoOpened: true,
  };

  try {
    await setDoc(doc(collection(db, CASH_SESSION_COLLECTION), sessionId), {
      ...session,
      openedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    // The cashier can still work if an old ruleset blocks session history.
    // Stock and sale synchronization remain handled by the sale flow.
    console.warn('[SMART_CAISSE] Session automatique non persistée:', error?.message || error);
  }

  state.sessions = [session, ...state.sessions];
  return session;
}

function getDateMs(value) {
  if (!value) return 0;
  const date = value?.toDate?.() || new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getRecentSales(selected, session, max = 4) {
  if (!selected) return [];
  return state.sales
    .filter((sale) => {
      const sameLocation = sale.locationId === selected.id;
      const sameSession = session?.id ? sale.sessionId === session.id : true;
      return sameLocation && sameSession;
    })
    .sort((a, b) => getDateMs(b.createdAt) - getDateMs(a.createdAt))
    .slice(0, max);
}

function catalogBalanceKey(productId = '', variantId = '') {
  return `${productId}|${variantId || ''}`;
}

function catalogItemMatches(item, search, activeCategory) {
  if (activeCategory !== 'all' && getCategorySlug(item.category) !== activeCategory) return false;
  const haystack = [
    item.productName,
    item.variantLabel,
    item.sku,
    item.category,
  ].filter(Boolean).join(' ').toLowerCase();
  return !search || haystack.includes(search);
}

function getBalanceCatalogItems(selected, products) {
  if (!selected) return [];
  return state.balances
    .filter((balance) => {
      if (balance.locationId !== selected.id) return false;
      if (String(balance.productStatus || '').toLowerCase() === 'inactive') return false;
      if (toNumber(balance.availableQty ?? balance.physicalQty) <= 0) return false;
      const product = products.get(balance.productId);
      return product && getProductStatus(product) !== 'inactive' && isVisibleInStore(product) && !isDigitalProduct(product);
    })
    .map((balance) => {
      const product = products.get(balance.productId) || {};
      return {
        key: `${balance.productId}|${balance.variantId || ''}|${balance.locationId}`,
        productId: balance.productId,
        variantId: balance.variantId || '',
        locationId: balance.locationId,
        productName: balance.productName || getProductName(product),
        variantLabel: balance.variantLabel || '',
        sku: balance.sku || product.sku || '',
        barcode: balance.barcode || product.barcode || '',
        category: getProductCategory(product, balance),
        image: getProductImage(product, balance),
        unitPrice: toNumber(balance.salePrice || balance.unitPrice || product.salePrice || product.price),
        unitCost: toNumber(balance.unitCost || balance.costPrice || product.purchasePrice || product.costPrice),
        availableQty: toNumber(balance.availableQty ?? (toNumber(balance.physicalQty) - toNumber(balance.reservedQty))),
        stockSource: 'balance',
      };
    });
}

function getProductFallbackCatalogItems(selected, balanceKeys) {
  const items = [];
  const locationId = selected?.id || '';
  state.products.forEach((product) => {
    if (!product.id || getProductStatus(product) === 'inactive' || !isVisibleInStore(product) || isDigitalProduct(product)) return;
    const variants = getProductVariants(product);
    if (variants.length) {
      variants.forEach((variant) => {
        if (String(variant.status || '').toLowerCase() === 'inactive' || variant.active === false) return;
        if (balanceKeys.has(catalogBalanceKey(product.id, variant.id))) return;
        const stock = getVariantStock(variant);
        if (stock <= 0) return;
        items.push({
          key: `${product.id}|${variant.id}|${locationId}`,
          productId: product.id,
          variantId: variant.id,
          locationId,
          productName: getProductName(product),
          variantLabel: variant.label,
          sku: variant.sku || product.sku || '',
          barcode: variant.barcode || variant.codebarre || product.barcode || '',
          category: getProductCategory(product),
          image: getVariantImage(product, variant),
          unitPrice: getProductSalePrice(product, variant),
          unitCost: getProductUnitCost(product, variant),
          availableQty: stock,
          oldGlobalStockObserved: stock,
          stockSource: 'product',
        });
      });
      return;
    }

    if (balanceKeys.has(catalogBalanceKey(product.id, ''))) return;
    const stock = getProductStock(product);
    if (stock <= 0) return;
    items.push({
      key: `${product.id}||${locationId}`,
      productId: product.id,
      variantId: '',
      locationId,
      productName: getProductName(product),
      variantLabel: '',
      sku: product.sku || '',
      barcode: product.barcode || product.codebarre || '',
      category: getProductCategory(product),
      image: getProductImage(product),
      unitPrice: getProductSalePrice(product),
      unitCost: getProductUnitCost(product),
      availableQty: stock,
      oldGlobalStockObserved: stock,
      stockSource: 'product',
    });
  });
  return items;
}

function getAllCatalogItems({ applyFilters = true } = {}) {
  const selected = getSelectedLocation();
  const products = new Map(state.products.map((product) => [product.id, product]));
  const balanceItems = getBalanceCatalogItems(selected, products);
  const balanceKeys = new Set(balanceItems.map((item) => catalogBalanceKey(item.productId, item.variantId)));
  const allItems = [
    ...balanceItems,
    ...getProductFallbackCatalogItems(selected, balanceKeys),
  ];
  const search = applyFilters ? normalizeText(state.search).toLowerCase() : '';
  const activeCategory = applyFilters ? state.activeCategory || 'all' : 'all';
  return allItems
    .filter((item) => catalogItemMatches(item, search, activeCategory))
    .sort((a, b) => a.productName.localeCompare(b.productName));
}

function getCatalogItems() {
  return getAllCatalogItems();
}

function getCartTotals() {
  const subtotal = state.cart.reduce((sum, item) => sum + toNumber(item.unitPrice) * toNumber(item.quantity), 0);
  // The cashier flow accepts the exact product total; discounts are not part of this screen.
  const requestedDiscount = Math.min(100, Math.max(0, toNumber(state.discount)));
  const discount = state.discountAuthorized && state.discountType === 'percent'
    ? Math.min(subtotal, subtotal * requestedDiscount / 100)
    : 0;
  const tax = 0;
  const total = Math.max(0, subtotal + tax - discount);
  const amountPaid = toNumber(state.amountPaid);
  return {
    subtotal,
    discount,
    tax,
    total,
    amountPaid,
    changeDue: Math.max(0, amountPaid - total),
    due: Math.max(0, total - amountPaid),
    itemCount: state.cart.reduce((sum, item) => sum + toNumber(item.quantity), 0),
  };
}

async function loadProfile(user) {
  let smartManagementSnap = null;
  try {
    smartManagementSnap = await getDoc(doc(db, 'smartManagementUsers', user.uid));
  } catch (error) {
    console.warn('[SMART_CAISSE] Profil Smart Management indisponible, fallback clients', {
      code: error?.code || '',
      message: error?.message || String(error),
    });
  }
  if (smartManagementSnap?.exists()) {
    const profile = { id: smartManagementSnap.id, ...smartManagementSnap.data() };
    console.info('[SMART_CAISSE] Profil chargé', { source: 'smartManagementUsers', role: getRole(profile) || null });
    return profile;
  }
  try {
    const clientSnap = await getDoc(doc(db, 'clients', user.uid));
    if (clientSnap.exists()) {
      const profile = { id: clientSnap.id, ...clientSnap.data() };
      console.info('[SMART_CAISSE] Profil chargé', { source: 'clients', role: getRole(profile) || null });
      return profile;
    }
  } catch (error) {
    console.warn('[SMART_CAISSE] Profil client indisponible', {
      code: error?.code || '',
      message: error?.message || String(error),
    });
  }
  return null;
}

async function loadWorkspace() {
  state.loading = true;
  renderApp();
  const [locations, products, categories, balances, movements, transfers, sessions, sales] = await Promise.all([
    // Do not order this query in Firestore: legacy locations may not have createdAt.
    // Sorting after the read keeps those valid locations visible to the cashier.
    safeDocs(collection(db, LOCATION_COLLECTION), [], LOCATION_COLLECTION),
    safeDocs(collection(db, PRODUCT_COLLECTION), [], PRODUCT_COLLECTION),
    safeDocs(collection(db, CATEGORY_COLLECTION), [], CATEGORY_COLLECTION),
    safeDocs(query(collection(db, STOCK_BALANCE_COLLECTION), orderBy('updatedAt', 'desc'), limit(600)), [], STOCK_BALANCE_COLLECTION),
    safeDocs(query(collection(db, STOCK_MOVEMENT_COLLECTION), limit(300)), [], STOCK_MOVEMENT_COLLECTION),
    safeDocs(query(collection(db, STOCK_TRANSFER_COLLECTION), limit(200)), [], STOCK_TRANSFER_COLLECTION),
    safeDocs(query(collection(db, CASH_SESSION_COLLECTION), orderBy('openedAt', 'desc'), limit(120)), [], CASH_SESSION_COLLECTION),
    safeDocs(query(collection(db, CASH_SALE_COLLECTION), orderBy('createdAt', 'desc'), limit(200)), [], CASH_SALE_COLLECTION),
  ]);
  state.locations = locations.sort((a, b) => getDateMs(b.createdAt || b.updatedAt) - getDateMs(a.createdAt || a.updatedAt));
  state.products = products;
  state.categories = categories;
  state.clients = [];
  state.balances = balances;
  state.movements = movements;
  state.transfers = transfers;
  state.sessions = sessions;
  state.sales = sales;
  if (!state.selectedLocationId || !getActiveLocations().some((location) => location.id === state.selectedLocationId)) {
    state.selectedLocationId = getActiveLocations()[0]?.id || '';
  }
  if (!isBackOfficeRole()) await ensureAutomaticSession();
  console.info('[SMART_CAISSE] Catalogue chargé', {
    locations: state.locations.length,
    products: state.products.length,
    categories: state.categories.length,
    stockBalances: state.balances.length,
    selectedLocationId: state.selectedLocationId || null,
    role: getRole(state.profile || {}) || null,
  });
  state.loading = false;
  renderApp();
}

function renderLogin(error = '') {
  root.innerHTML = `
    <section class="login-screen">
      <form class="login-card login-card-single" id="loginForm">
        <div class="login-card-head">
          <div>
            <p class="eyebrow">Connexion caisse</p>
            <h2>Accès au terminal</h2>
          </div>
        </div>
        <label>
          <span>Email</span>
          <input id="emailInput" type="email" autocomplete="email" required>
        </label>
        <label>
          <span>Mot de passe</span>
          <input id="passwordInput" type="password" autocomplete="current-password" required>
        </label>
        ${error ? `<div class="error-box">${escapeHtml(error)}</div>` : ''}
        <button class="primary-action" type="submit">${icon('log-in')} Se connecter</button>
      </form>
    </section>
  `;
  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  refreshIcons();
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('emailInput')?.value || '';
  const password = document.getElementById('passwordInput')?.value || '';
  try {
    await authReadyPromise.catch(() => null);
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    renderLogin('Connexion impossible. Vérifiez l’email et le mot de passe.');
  }
}

function renderForbidden() {
  root.innerHTML = `
    <section class="login-screen">
      <div class="login-card center-card">
        <div class="brand-dot">SC</div>
        <h2>Accès non autorisé</h2>
        <p>Ce compte n’a pas encore le rôle caissier, manager ou administrateur.</p>
        <button class="secondary-action" id="logoutBtn" type="button">${icon('log-out')} Changer de compte</button>
      </div>
    </section>
  `;
  document.getElementById('logoutBtn')?.addEventListener('click', () => signOut(auth));
  refreshIcons();
}

function managerLocationMatches(record = {}) {
  return state.managerLocationId === 'all' || !state.managerLocationId || record.locationId === state.managerLocationId;
}

function managerPeriodMatches(value) {
  const period = String(state.managerPeriod || '30');
  if (period === 'all') return true;
  const dateMs = getDateMs(value);
  if (!dateMs) return false;
  const days = Number(period);
  return dateMs >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function getManagerSales() {
  const search = normalizeText(state.managerSearch).toLowerCase();
  return state.sales
    .filter((sale) => String(sale.status || 'completed').toLowerCase() !== 'failed')
    .filter((sale) => managerLocationMatches(sale))
    .filter((sale) => managerPeriodMatches(sale.createdAt || sale.completedAt))
    .filter((sale) => {
      if (!search) return true;
      const haystack = [
        sale.reference,
        sale.locationName,
        sale.cashierName,
        sale.createdByName,
        ...(Array.isArray(sale.items) ? sale.items.flatMap((item) => [item.productName, item.sku]) : []),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => getDateMs(b.createdAt || b.completedAt) - getDateMs(a.createdAt || a.completedAt));
}

function getManagerStockRows() {
  const productMap = new Map(state.products.map((product) => [product.id, product]));
  const rows = state.balances
    .filter((balance) => managerLocationMatches(balance))
    .map((balance) => {
      const product = productMap.get(balance.productId) || {};
      const availableQty = toNumber(balance.availableQty ?? (toNumber(balance.physicalQty) - toNumber(balance.reservedQty)));
      return {
        id: `${balance.productId}|${balance.variantId || ''}|${balance.locationId || ''}`,
        name: balance.productName || getProductName(product),
        sku: balance.sku || product.sku || '-',
        locationName: balance.locationName || state.locations.find((location) => location.id === balance.locationId)?.name || 'Magasin principal',
        availableQty,
        unitPrice: toNumber(balance.salePrice || balance.unitPrice || product.salePrice || product.price),
        updatedAt: balance.updatedAt,
      };
    });
  if (rows.length) return rows;

  return state.products
    .filter((product) => getProductStatus(product) !== 'inactive' && !isDigitalProduct(product))
    .map((product) => ({
      id: product.id,
      name: getProductName(product),
      sku: product.sku || '-',
      locationName: 'Catalogue global',
      availableQty: getProductStock(product),
      unitPrice: getProductSalePrice(product),
      updatedAt: product.updatedAt,
    }));
}

function getManagerMetrics() {
  const sales = getManagerSales();
  const todayKey = new Date().toLocaleDateString('fr-FR');
  const todaySales = sales.filter((sale) => new Date(getDateMs(sale.createdAt || sale.completedAt)).toLocaleDateString('fr-FR') === todayKey);
  const itemCount = sales.reduce((sum, sale) => sum + toNumber(sale.itemCount || (Array.isArray(sale.items) ? sale.items.reduce((lineSum, item) => lineSum + toNumber(item.quantity), 0) : 0)), 0);
  const lowStock = getManagerStockRows().filter((row) => row.availableQty > 0 && row.availableQty <= 3);
  const openSessions = state.sessions.filter((session) => managerLocationMatches(session) && String(session.status || 'open').toLowerCase() !== 'closed');
  return {
    sales,
    todaySales,
    revenue: sales.reduce((sum, sale) => sum + toNumber(sale.total), 0),
    todayRevenue: todaySales.reduce((sum, sale) => sum + toNumber(sale.total), 0),
    itemCount,
    lowStock,
    openSessions,
  };
}

function renderManagerWorkspace() {
  return `
    <main class="manager-workspace">
      <header class="manager-page-head">
        <div>
          <p class="eyebrow">Supervision boutique</p>
          <h2>${escapeHtml({
            'manager-overview': 'Vue d\'ensemble',
            'manager-sales': 'Ventes',
            'manager-stock': 'Stock',
            'manager-reports': 'Rapports',
            'manager-sessions': 'Sessions de caisse',
          }[state.activeView] || 'Vue d\'ensemble')}</h2>
          <p>Suivez l'activite du magasin sans modifier les parametres administrateur.</p>
        </div>
        <div class="manager-page-actions">
          <select id="managerPeriodSelect" aria-label="Periode du rapport">
            <option value="7" ${state.managerPeriod === '7' ? 'selected' : ''}>7 derniers jours</option>
            <option value="30" ${state.managerPeriod === '30' ? 'selected' : ''}>30 derniers jours</option>
            <option value="all" ${state.managerPeriod === 'all' ? 'selected' : ''}>Toute la periode</option>
          </select>
          <button class="secondary-action" id="managerRefreshBtn" type="button">${icon('refresh-cw')} Actualiser</button>
        </div>
      </header>
      <section class="manager-data-region">
        ${renderManagerView(state.activeView)}
      </section>
    </main>
  `;
}

function renderManagerView(view) {
  if (view === 'manager-sales') return renderManagerSalesView();
  if (view === 'manager-stock') return renderManagerStockView();
  if (view === 'manager-reports') return renderManagerReportsView();
  if (view === 'manager-sessions') return renderManagerSessionsView();
  return renderManagerOverviewView();
}

function renderManagerStat(label, value, detail, tone = 'blue', iconName = 'activity') {
  return `
    <article class="manager-stat manager-stat-${tone}">
      <span>${icon(iconName)}</span>
      <div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><em>${escapeHtml(detail)}</em></div>
    </article>
  `;
}

function renderManagerOverviewView() {
  const metrics = getManagerMetrics();
  const recentSales = metrics.sales.slice(0, 6);
  const stockRows = getManagerStockRows().sort((a, b) => a.availableQty - b.availableQty).slice(0, 6);
  return `
    <section class="manager-stat-grid">
      ${renderManagerStat('Ventes aujourd\'hui', formatMoney(metrics.todayRevenue), `${metrics.todaySales.length} transaction(s)`, 'blue', 'trending-up')}
      ${renderManagerStat('Ventes de la periode', formatMoney(metrics.revenue), `${metrics.sales.length} vente(s)`, 'green', 'receipt-text')}
      ${renderManagerStat('Articles vendus', String(metrics.itemCount), 'Toutes les caisses', 'gold', 'package-check')}
      ${renderManagerStat('Stock faible', String(metrics.lowStock.length), 'Produit(s) a surveiller', metrics.lowStock.length ? 'red' : 'green', 'alert-triangle')}
    </section>
    <section class="manager-content-grid">
      <article class="manager-panel manager-panel-wide">
        <div class="manager-panel-head"><div><p class="eyebrow">Activite</p><h3>Ventes recentes</h3></div><button class="text-action" data-manager-view="manager-sales" type="button">Voir tout ${icon('arrow-right')}</button></div>
        <div class="manager-table manager-table-compact">
          <div class="manager-table-row manager-table-header"><span>Reference</span><span>Point de vente</span><span>Date</span><span>Total</span></div>
          ${recentSales.length ? recentSales.map((sale) => `
            <div class="manager-table-row"><strong>${escapeHtml(sale.reference || 'Vente caisse')}</strong><span>${escapeHtml(sale.locationName || 'Magasin')}</span><span>${escapeHtml(formatDate(sale.createdAt || sale.completedAt))}</span><b>${escapeHtml(formatMoney(sale.total))}</b></div>
          `).join('') : renderManagerEmpty('Aucune vente recente', 'Les ventes validees apparaitront ici.', 'receipt-text')}
        </div>
      </article>
      <article class="manager-panel">
        <div class="manager-panel-head"><div><p class="eyebrow">Inventaire</p><h3>Stock a surveiller</h3></div><button class="text-action" data-manager-view="manager-stock" type="button">Ouvrir ${icon('arrow-right')}</button></div>
        <div class="manager-watch-list">
          ${stockRows.length ? stockRows.map((row) => `<div><span>${icon(row.availableQty <= 0 ? 'circle-alert' : 'package')}</span><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.locationName)}</small></div><b class="${row.availableQty <= 3 ? 'is-low' : ''}">${escapeHtml(row.availableQty)}</b></div>`).join('') : renderManagerEmpty('Aucun stock disponible', 'Les produits seront affiches apres synchronisation.', 'package-open')}
        </div>
      </article>
    </section>
    <section class="manager-panel manager-quick-panel">
      <div class="manager-panel-head"><div><p class="eyebrow">Equipe</p><h3>Sessions actuellement ouvertes</h3></div><button class="text-action" data-manager-view="manager-sessions" type="button">Superviser ${icon('arrow-right')}</button></div>
      <div class="manager-session-strip">
        ${metrics.openSessions.length ? metrics.openSessions.slice(0, 4).map((session) => `<span>${icon('circle-dot')} <strong>${escapeHtml(session.openedByName || 'Caissier')}</strong><small>${escapeHtml(session.locationName || 'Magasin')} · ${escapeHtml(formatMoney(session.totalSales))}</small></span>`).join('') : renderManagerEmpty('Aucune session ouverte', 'Aucun caissier n\'est actuellement en service.', 'wallet-cards')}
      </div>
    </section>
  `;
}

function renderManagerSalesView() {
  const sales = getManagerSales();
  return `
    <article class="manager-panel manager-panel-full">
      <div class="manager-filter-bar">
        <label class="manager-search-field">${icon('search')}<input id="managerSearchInput" type="search" value="${escapeHtml(state.managerSearch)}" placeholder="Rechercher une vente, un produit ou un SKU"></label>
        <span class="manager-result-count">${escapeHtml(sales.length)} vente(s)</span>
      </div>
      <div class="manager-table">
        <div class="manager-table-row manager-table-header"><span>Reference</span><span>Caissier</span><span>Point de vente</span><span>Date</span><span>Articles</span><span>Total</span></div>
        ${sales.length ? sales.slice(0, 100).map((sale) => `<div class="manager-table-row"><strong>${escapeHtml(sale.reference || 'Vente caisse')}</strong><span>${escapeHtml(sale.createdByName || sale.cashierName || 'Caissier')}</span><span>${escapeHtml(sale.locationName || 'Magasin')}</span><span>${escapeHtml(formatDate(sale.createdAt || sale.completedAt))}</span><span>${escapeHtml(sale.itemCount || 0)}</span><b>${escapeHtml(formatMoney(sale.total))}</b></div>`).join('') : renderManagerEmpty('Aucune vente trouvee', 'Modifiez la periode ou la recherche.', 'receipt-text')}
      </div>
    </article>
  `;
}

function renderManagerStockView() {
  const search = normalizeText(state.managerSearch).toLowerCase();
  const rows = getManagerStockRows().filter((row) => !search || `${row.name} ${row.sku} ${row.locationName}`.toLowerCase().includes(search)).sort((a, b) => a.availableQty - b.availableQty);
  return `
    <article class="manager-panel manager-panel-full">
      <div class="manager-filter-bar">
        <label class="manager-search-field">${icon('search')}<input id="managerSearchInput" type="search" value="${escapeHtml(state.managerSearch)}" placeholder="Rechercher un produit ou un SKU"></label>
        <span class="manager-result-count">${escapeHtml(rows.length)} produit(s)</span>
      </div>
      <div class="manager-table">
        <div class="manager-table-row manager-table-header"><span>Produit</span><span>SKU</span><span>Emplacement</span><span>Quantite</span><span>Prix</span><span>Etat</span></div>
        ${rows.length ? rows.slice(0, 150).map((row) => `<div class="manager-table-row"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.sku)}</span><span>${escapeHtml(row.locationName)}</span><span>${escapeHtml(row.availableQty)}</span><span>${escapeHtml(formatMoney(row.unitPrice))}</span><b class="stock-status ${row.availableQty <= 3 ? 'is-low' : row.availableQty <= 0 ? 'is-out' : ''}">${row.availableQty <= 0 ? 'Rupture' : row.availableQty <= 3 ? 'Faible' : 'Disponible'}</b></div>`).join('') : renderManagerEmpty('Aucun produit trouve', 'Le catalogue ou les balances de stock ne sont pas disponibles.', 'package-open')}
      </div>
    </article>
  `;
}

function renderManagerReportsView() {
  const metrics = getManagerMetrics();
  const byLocation = new Map();
  metrics.sales.forEach((sale) => {
    const label = sale.locationName || 'Magasin';
    const current = byLocation.get(label) || { total: 0, count: 0 };
    current.total += toNumber(sale.total);
    current.count += 1;
    byLocation.set(label, current);
  });
  const locations = [...byLocation.entries()].sort((a, b) => b[1].total - a[1].total);
  return `
    <section class="manager-report-grid">
      <article class="manager-panel"><p class="eyebrow">Performance</p><h3>Resume de la periode</h3><div class="manager-report-total">${escapeHtml(formatMoney(metrics.revenue))}</div><p class="manager-muted">Chiffre d'affaires encaisse sur ${escapeHtml(metrics.sales.length)} transaction(s).</p></article>
      <article class="manager-panel"><p class="eyebrow">Activite</p><h3>Sessions ouvertes</h3><div class="manager-report-total">${escapeHtml(metrics.openSessions.length)}</div><p class="manager-muted">Caissier(s) actuellement en service.</p></article>
    </section>
    <article class="manager-panel manager-panel-full">
      <div class="manager-panel-head"><div><p class="eyebrow">Repartition</p><h3>Ventes par point de vente</h3></div></div>
      <div class="manager-location-report">
        ${locations.length ? locations.map(([label, value]) => `<div><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value.count)} vente(s)</span></div><div class="manager-bar"><span style="width:${Math.min(100, metrics.revenue ? value.total / metrics.revenue * 100 : 0)}%"></span></div><b>${escapeHtml(formatMoney(value.total))}</b></div>`).join('') : renderManagerEmpty('Aucune donnee de rapport', 'Les ventes apparaitront apres une transaction validee.', 'bar-chart-3')}
      </div>
    </article>
  `;
}

function renderManagerSessionsView() {
  const sessions = state.sessions.filter((session) => managerLocationMatches(session)).sort((a, b) => getDateMs(b.openedAt) - getDateMs(a.openedAt));
  return `
    <article class="manager-panel manager-panel-full">
      <div class="manager-filter-bar"><div><p class="eyebrow">Supervision</p><h3>Sessions de caisse</h3></div><span class="manager-result-count">${escapeHtml(sessions.length)} session(s)</span></div>
      <div class="manager-table">
        <div class="manager-table-row manager-table-header"><span>Caissier</span><span>Point de vente</span><span>Ouverture</span><span>Ventes</span><span>Total</span><span>Etat</span></div>
        ${sessions.length ? sessions.slice(0, 100).map((session) => `<div class="manager-table-row"><strong>${escapeHtml(session.openedByName || 'Caissier')}</strong><span>${escapeHtml(session.locationName || 'Magasin')}</span><span>${escapeHtml(formatDate(session.openedAt))}</span><span>${escapeHtml(session.saleCount || 0)}</span><span>${escapeHtml(formatMoney(session.totalSales))}</span><b class="session-status ${String(session.status || 'open').toLowerCase() === 'closed' ? 'closed' : ''}">${String(session.status || 'open').toLowerCase() === 'closed' ? 'Fermee' : 'Ouverte'}</b></div>`).join('') : renderManagerEmpty('Aucune session', 'Aucune session de caisse n\'est enregistree.', 'wallet-cards')}
      </div>
    </article>
  `;
}

function renderManagerEmpty(title, message, iconName) {
  return `<div class="manager-empty">${icon(iconName)}<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`;
}

function refreshManagerRegion() {
  const region = document.querySelector('.manager-data-region');
  if (!region || !isManager()) return;
  region.innerHTML = renderManagerView(state.activeView);
  refreshIcons();
}

function stockPeriodMatches(value) {
  const period = String(state.stockPeriod || '30');
  if (period === 'all') return true;
  const dateMs = getDateMs(value);
  if (!dateMs) return false;
  return dateMs >= Date.now() - Number(period) * 24 * 60 * 60 * 1000;
}

function getStockMovements() {
  const search = normalizeText(state.stockSearch).toLowerCase();
  return state.movements
    .filter((movement) => stockPeriodMatches(movement.createdAt || movement.occurredAt || movement.updatedAt))
    .filter((movement) => {
      if (!search) return true;
      return [movement.productName, movement.sku, movement.type, movement.reason, movement.locationName]
        .filter(Boolean).join(' ').toLowerCase().includes(search);
    })
    .sort((a, b) => getDateMs(b.createdAt || b.occurredAt || b.updatedAt) - getDateMs(a.createdAt || a.occurredAt || a.updatedAt));
}

function getStockTransfers() {
  const search = normalizeText(state.stockSearch).toLowerCase();
  return state.transfers
    .filter((transfer) => {
      if (!search) return true;
      return [transfer.reference, transfer.fromLocationName, transfer.toLocationName, transfer.status]
        .filter(Boolean).join(' ').toLowerCase().includes(search);
    })
    .sort((a, b) => getDateMs(b.createdAt || b.updatedAt) - getDateMs(a.createdAt || a.updatedAt));
}

function getStockMetrics() {
  const rows = getManagerStockRows();
  const movements = getStockMovements();
  const transfers = getStockTransfers();
  return {
    rows,
    movements,
    transfers,
    totalUnits: rows.reduce((sum, row) => sum + Math.max(0, toNumber(row.availableQty)), 0),
    lowStock: rows.filter((row) => row.availableQty > 0 && row.availableQty <= 3),
    outOfStock: rows.filter((row) => row.availableQty <= 0),
    locations: new Set(rows.map((row) => row.locationName).filter(Boolean)).size,
  };
}

function renderStockWorkspace() {
  const titles = {
    'stock-overview': 'Vue d\'ensemble stock',
    'stock-inventory': 'Inventaire',
    'stock-products': 'Produits',
    'stock-movements': 'Mouvements de stock',
    'stock-transfers': 'Transferts',
    'stock-physical': 'Inventaire physique',
    'stock-locations': 'Magasins et dépôts',
    'stock-reports': 'Rapports stock',
  };
  return `
    <main class="manager-workspace stock-workspace">
      <header class="manager-page-head">
        <div>
          <p class="eyebrow">Gestion des stocks</p>
          <h2>${escapeHtml(titles[state.activeView] || titles['stock-overview'])}</h2>
          <p>Contrôlez les quantités réelles, les mouvements et les écarts de stock.</p>
        </div>
        <div class="manager-page-actions">
          <select id="stockPeriodSelect" aria-label="Période des mouvements">
            <option value="7" ${state.stockPeriod === '7' ? 'selected' : ''}>7 derniers jours</option>
            <option value="30" ${state.stockPeriod === '30' ? 'selected' : ''}>30 derniers jours</option>
            <option value="all" ${state.stockPeriod === 'all' ? 'selected' : ''}>Toute la période</option>
          </select>
          <button class="secondary-action" id="stockRefreshBtn" type="button">${icon('refresh-cw')} Actualiser</button>
        </div>
      </header>
      <section class="manager-data-region stock-data-region">
        ${renderStockView(state.activeView)}
      </section>
    </main>
  `;
}

function renderStockView(view) {
  if (view === 'stock-inventory') return renderStockInventoryView();
  if (view === 'stock-products') return renderStockProductsView();
  if (view === 'stock-movements') return renderStockMovementsView();
  if (view === 'stock-transfers') return renderStockTransfersView();
  if (view === 'stock-physical') return renderStockPhysicalView();
  if (view === 'stock-locations') return renderStockLocationsView();
  if (view === 'stock-reports') return renderStockReportsView();
  return renderStockOverviewView();
}

function renderStockOverviewView() {
  const metrics = getStockMetrics();
  const alerts = [...metrics.outOfStock, ...metrics.lowStock].sort((a, b) => a.availableQty - b.availableQty).slice(0, 7);
  return `
    <section class="manager-stat-grid">
      ${renderManagerStat('Unités disponibles', String(metrics.totalUnits), 'Stock enregistré', 'blue', 'boxes')}
      ${renderManagerStat('Produits suivis', String(metrics.rows.length), `${metrics.locations} emplacement(s)`, 'green', 'package-search')}
      ${renderManagerStat('Stock faible', String(metrics.lowStock.length), 'À réapprovisionner', metrics.lowStock.length ? 'gold' : 'green', 'alert-triangle')}
      ${renderManagerStat('Ruptures', String(metrics.outOfStock.length), 'Produit(s) indisponible(s)', metrics.outOfStock.length ? 'red' : 'green', 'circle-alert')}
    </section>
    <section class="manager-content-grid">
      <article class="manager-panel manager-panel-wide">
        <div class="manager-panel-head"><div><p class="eyebrow">Contrôle quotidien</p><h3>Alertes de stock</h3></div><button class="text-action" data-stock-view="stock-inventory" type="button">Voir l'inventaire ${icon('arrow-right')}</button></div>
        <div class="manager-watch-list">
          ${alerts.length ? alerts.map((row) => `<div><span>${icon(row.availableQty <= 0 ? 'circle-alert' : 'alert-triangle')}</span><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.locationName)} · ${escapeHtml(row.sku)}</small></div><b class="${row.availableQty <= 0 ? 'is-low' : ''}">${row.availableQty <= 0 ? 'Rupture' : `${row.availableQty} restant(s)`}</b></div>`).join('') : renderManagerEmpty('Aucune alerte', 'Les niveaux de stock sont actuellement corrects.', 'badge-check')}
        </div>
      </article>
      <article class="manager-panel">
        <div class="manager-panel-head"><div><p class="eyebrow">Derniers mouvements</p><h3>Activité stock</h3></div><button class="text-action" data-stock-view="stock-movements" type="button">Tout voir ${icon('arrow-right')}</button></div>
        <div class="manager-watch-list">
          ${metrics.movements.slice(0, 5).map((movement) => `<div><span>${icon(toNumber(movement.quantity) < 0 ? 'arrow-down-left' : 'arrow-up-right')}</span><div><strong>${escapeHtml(movement.productName || movement.sku || 'Produit')}</strong><small>${escapeHtml(movement.type || 'Mouvement')} · ${escapeHtml(formatDate(movement.createdAt || movement.occurredAt))}</small></div><b class="${toNumber(movement.quantity) < 0 ? 'is-low' : ''}">${toNumber(movement.quantity) > 0 ? '+' : ''}${escapeHtml(toNumber(movement.quantity))}</b></div>`).join('') || renderManagerEmpty('Aucun mouvement', 'Les entrées et sorties apparaitront ici.', 'arrow-up-down')}
        </div>
      </article>
    </section>
    <section class="manager-panel manager-quick-panel">
      <div class="manager-panel-head"><div><p class="eyebrow">Logistique</p><h3>Transferts récents</h3></div><button class="text-action" data-stock-view="stock-transfers" type="button">Superviser ${icon('arrow-right')}</button></div>
      <div class="manager-session-strip">
        ${metrics.transfers.slice(0, 4).map((transfer) => `<span>${icon('arrow-right-left')} <strong>${escapeHtml(transfer.reference || 'Transfert')}</strong><small>${escapeHtml(transfer.fromLocationName || 'Origine')} → ${escapeHtml(transfer.toLocationName || 'Destination')} · ${escapeHtml(transfer.status || 'brouillon')}</small></span>`).join('') || renderManagerEmpty('Aucun transfert', 'Les transferts entre emplacements apparaitront ici.', 'arrow-right-left')}
      </div>
    </section>
  `;
}

function renderStockTableToolbar(count, placeholder) {
  return `<div class="manager-filter-bar"><label class="manager-search-field">${icon('search')}<input id="stockSearchInput" type="search" value="${escapeHtml(state.stockSearch)}" placeholder="${escapeHtml(placeholder)}"></label><span class="manager-result-count">${escapeHtml(count)} élément(s)</span></div>`;
}

function renderStockInventoryView() {
  const search = normalizeText(state.stockSearch).toLowerCase();
  const rows = getManagerStockRows().filter((row) => !search || `${row.name} ${row.sku} ${row.locationName}`.toLowerCase().includes(search)).sort((a, b) => a.availableQty - b.availableQty);
  return `<article class="manager-panel manager-panel-full">${renderStockTableToolbar(rows.length, 'Rechercher un produit, SKU ou emplacement')}<div class="manager-table"><div class="manager-table-row manager-table-header"><span>Produit</span><span>SKU</span><span>Emplacement</span><span>Quantité</span><span>Prix</span><span>État</span></div>${rows.length ? rows.slice(0, 200).map((row) => `<div class="manager-table-row"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.sku)}</span><span>${escapeHtml(row.locationName)}</span><span>${escapeHtml(row.availableQty)}</span><span>${escapeHtml(formatMoney(row.unitPrice))}</span><b class="stock-status ${row.availableQty <= 0 ? 'is-out' : row.availableQty <= 3 ? 'is-low' : ''}">${row.availableQty <= 0 ? 'Rupture' : row.availableQty <= 3 ? 'Faible' : 'Disponible'}</b></div>`).join('') : renderManagerEmpty('Aucun stock trouvé', 'Aucun produit ne correspond à votre recherche.', 'package-open')}</div></article>`;
}

function renderStockProductsView() {
  const search = normalizeText(state.stockSearch).toLowerCase();
  const products = state.products.filter((product) => getProductStatus(product) !== 'inactive' && !isDigitalProduct(product)).filter((product) => !search || `${getProductName(product)} ${product.sku || ''}`.toLowerCase().includes(search));
  return `<article class="manager-panel manager-panel-full">${renderStockTableToolbar(products.length, 'Rechercher un produit ou un SKU')}<div class="manager-table"><div class="manager-table-row manager-table-header"><span>Produit</span><span>SKU</span><span>Catégorie</span><span>Stock catalogue</span><span>Prix</span><span>Statut</span></div>${products.length ? products.slice(0, 200).map((product) => `<div class="manager-table-row"><strong>${escapeHtml(getProductName(product))}</strong><span>${escapeHtml(product.sku || '-')}</span><span>${escapeHtml(product.categoryName || product.category || 'Sans catégorie')}</span><span>${escapeHtml(getProductStock(product))}</span><span>${escapeHtml(formatMoney(getProductSalePrice(product)))}</span><b class="stock-status">Actif</b></div>`).join('') : renderManagerEmpty('Aucun produit trouvé', 'Le catalogue produit est vide ou ne correspond pas à la recherche.', 'package-open')}</div></article>`;
}

function renderStockMovementsView() {
  const movements = getStockMovements();
  return `<article class="manager-panel manager-panel-full">${renderStockTableToolbar(movements.length, 'Rechercher un mouvement, produit ou SKU')}<div class="manager-table"><div class="manager-table-row manager-table-header"><span>Date</span><span>Produit</span><span>Type</span><span>Emplacement</span><span>Quantité</span><span>Raison</span></div>${movements.length ? movements.slice(0, 200).map((movement) => `<div class="manager-table-row"><strong>${escapeHtml(formatDate(movement.createdAt || movement.occurredAt || movement.updatedAt))}</strong><span>${escapeHtml(movement.productName || movement.sku || '-')}</span><span>${escapeHtml(movement.type || 'Mouvement')}</span><span>${escapeHtml(movement.locationName || 'Magasin')}</span><b class="${toNumber(movement.quantity) < 0 ? 'stock-status is-low' : 'stock-status'}">${toNumber(movement.quantity) > 0 ? '+' : ''}${escapeHtml(toNumber(movement.quantity))}</b><span>${escapeHtml(movement.reason || movement.note || '-')}</span></div>`).join('') : renderManagerEmpty('Aucun mouvement trouvé', 'Les mouvements de stock de la période apparaitront ici.', 'arrow-up-down')}</div></article>`;
}

function renderStockTransfersView() {
  const transfers = getStockTransfers();
  return `<article class="manager-panel manager-panel-full">${renderStockTableToolbar(transfers.length, 'Rechercher un transfert ou un emplacement')}<div class="manager-table"><div class="manager-table-row manager-table-header"><span>Référence</span><span>Origine</span><span>Destination</span><span>Créé le</span><span>Unités</span><span>Statut</span></div>${transfers.length ? transfers.slice(0, 150).map((transfer) => `<div class="manager-table-row"><strong>${escapeHtml(transfer.reference || transfer.id)}</strong><span>${escapeHtml(transfer.fromLocationName || '-')}</span><span>${escapeHtml(transfer.toLocationName || '-')}</span><span>${escapeHtml(formatDate(transfer.createdAt || transfer.updatedAt))}</span><span>${escapeHtml(transfer.totalUnits || transfer.quantity || 0)}</span><b class="stock-status">${escapeHtml(transfer.status || 'Brouillon')}</b></div>`).join('') : renderManagerEmpty('Aucun transfert', 'Les transferts entre magasins et dépôts apparaitront ici.', 'arrow-right-left')}</div></article>`;
}

function renderStockPhysicalView() {
  const metrics = getStockMetrics();
  const adjustments = state.movements.filter((movement) => String(movement.type || '').toUpperCase().includes('ADJUST')).slice(0, 30);
  return `<section class="manager-content-grid"><article class="manager-panel manager-panel-wide"><div class="manager-panel-head"><div><p class="eyebrow">Contrôle réel</p><h3>Inventaire physique</h3></div><span class="manager-result-count">${escapeHtml(metrics.rows.length)} ligne(s) de stock</span></div><p class="manager-muted">Comparez les quantités comptées sur place avec les quantités du système. Les corrections validées sont conservées dans les mouvements de stock.</p><div class="manager-report-total">${escapeHtml(metrics.totalUnits)} unités</div><p class="manager-muted">Unités actuellement enregistrées dans les emplacements suivis.</p></article><article class="manager-panel"><div class="manager-panel-head"><div><p class="eyebrow">Historique</p><h3>Derniers écarts</h3></div></div><div class="manager-watch-list">${adjustments.length ? adjustments.map((movement) => `<div><span>${icon('clipboard-check')}</span><div><strong>${escapeHtml(movement.productName || movement.sku || 'Produit')}</strong><small>${escapeHtml(formatDate(movement.createdAt || movement.updatedAt))}</small></div><b class="${toNumber(movement.quantity) < 0 ? 'is-low' : ''}">${toNumber(movement.quantity) > 0 ? '+' : ''}${escapeHtml(toNumber(movement.quantity))}</b></div>`).join('') : renderManagerEmpty('Aucun écart récent', 'Les ajustements physiques apparaitront ici.', 'clipboard-check')}</div></article></section>`;
}

function renderStockLocationsView() {
  const locations = getActiveLocations();
  const rows = locations.map((location) => ({ location, total: getManagerStockRows().filter((row) => row.locationName === location.name).reduce((sum, row) => sum + Math.max(0, row.availableQty), 0) }));
  return `<article class="manager-panel manager-panel-full"><div class="manager-panel-head"><div><p class="eyebrow">Emplacements</p><h3>Magasins et dépôts</h3></div><span class="manager-result-count">${escapeHtml(locations.length)} actif(s)</span></div><div class="manager-table"><div class="manager-table-row manager-table-header"><span>Nom</span><span>Type</span><span>Ville</span><span>Unités suivies</span><span>Statut</span></div>${rows.length ? rows.map(({ location, total }) => `<div class="manager-table-row"><strong>${escapeHtml(location.name || 'Emplacement')}</strong><span>${escapeHtml(location.type || 'store')}</span><span>${escapeHtml(location.city || location.address || '-')}</span><span>${escapeHtml(total)}</span><b class="stock-status">Actif</b></div>`).join('') : renderManagerEmpty('Aucun emplacement actif', 'Les magasins et dépôts apparaitront après configuration.', 'warehouse')}</div></article>`;
}

function renderStockReportsView() {
  const metrics = getStockMetrics();
  const byLocation = new Map();
  metrics.rows.forEach((row) => byLocation.set(row.locationName, (byLocation.get(row.locationName) || 0) + Math.max(0, row.availableQty)));
  const locations = [...byLocation.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...locations.map(([, total]) => total));
  return `<section class="manager-report-grid"><article class="manager-panel"><p class="eyebrow">Synthèse</p><h3>Stock disponible</h3><div class="manager-report-total">${escapeHtml(metrics.totalUnits)} unités</div><p class="manager-muted">${escapeHtml(metrics.rows.length)} ligne(s) de stock suivie(s).</p></article><article class="manager-panel"><p class="eyebrow">Qualité stock</p><h3>Alertes à traiter</h3><div class="manager-report-total">${escapeHtml(metrics.lowStock.length + metrics.outOfStock.length)}</div><p class="manager-muted">Stock faible ou en rupture.</p></article></section><article class="manager-panel manager-panel-full"><div class="manager-panel-head"><div><p class="eyebrow">Répartition</p><h3>Unités par emplacement</h3></div></div><div class="manager-location-report">${locations.length ? locations.map(([label, total]) => `<div><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(total)} unité(s)</span></div><div class="manager-bar"><span style="width:${Math.min(100, total / max * 100)}%"></span></div></div>`).join('') : renderManagerEmpty('Aucune donnée stock', 'Les rapports apparaitront après synchronisation.', 'bar-chart-3')}</div></article>`;
}

function refreshStockRegion() {
  const region = document.querySelector('.stock-data-region');
  if (!region || !isStockManager()) return;
  region.innerHTML = renderStockView(state.activeView);
  refreshIcons();
}

function renderApp() {
  if (!state.user) return renderLogin();
  if (!state.profile || !canUseCaisse(state.profile)) return renderForbidden();
  if (state.loading) return renderLoading();

  const selected = getSelectedLocation();
  const manager = isManager();
  const stockManager = isStockManager();
  const session = isBackOfficeRole() ? null : getOpenSession();
  root.innerHTML = `
    <section class="cashier-app ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}">
      ${renderSidebar(session)}
      <div class="cashier-main">
        ${renderHeader(selected, session)}
      ${manager ? renderManagerWorkspace() : stockManager ? renderStockWorkspace() : renderSellingScreen(selected, session)}
      </div>
      ${renderNotice()}
      ${state.closeSessionModal && session ? renderCloseSessionModal(session) : ''}
      ${state.discountModalOpen ? renderDiscountAuthorizationModal() : ''}
    </section>
  `;
  bindAppEvents();
  refreshIcons();
}

function renderLoading() {
  root.innerHTML = `
    <section class="app-loader" aria-label="Chargement">
      <span></span>
    </section>
  `;
}

function renderSidebar(session) {
  if (isManager()) {
    return `
      <aside class="cashier-sidebar manager-sidebar" aria-label="Navigation manager">
        <div class="sidebar-rail">
          <button class="rail-logo fullscreen-toggle" id="fullscreenToggleBtn" type="button" aria-label="Ouvrir en plein ecran" title="Ouvrir en plein ecran">
            ${icon('maximize-2')}
          </button>
        </div>
        <div class="sidebar-panel">
          <div class="sidebar-title">
            <strong>Smart Cut</strong>
            <small>Gestion boutique</small>
          </div>
          <nav class="sidebar-nav">
            <button class="${state.activeView === 'manager-overview' ? 'active' : ''}" data-manager-view="manager-overview" type="button">${icon('layout-dashboard')}<span>Vue d'ensemble</span></button>
            <button class="${state.activeView === 'manager-sales' ? 'active' : ''}" data-manager-view="manager-sales" type="button">${icon('receipt-text')}<span>Ventes</span></button>
            <button class="${state.activeView === 'manager-stock' ? 'active' : ''}" data-manager-view="manager-stock" type="button">${icon('package-search')}<span>Stock</span></button>
            <button class="${state.activeView === 'manager-reports' ? 'active' : ''}" data-manager-view="manager-reports" type="button">${icon('chart-no-axes-combined')}<span>Rapports</span></button>
            <button class="${state.activeView === 'manager-sessions' ? 'active' : ''}" data-manager-view="manager-sessions" type="button">${icon('wallet-cards')}<span>Sessions de caisse</span></button>
            <button id="sidebarLogoutBtn" type="button">${icon('log-out')}<span>Deconnexion</span></button>
          </nav>
        </div>
      </aside>
    `;
  }
  if (isStockManager()) {
    return `
      <aside class="cashier-sidebar manager-sidebar stock-sidebar" aria-label="Navigation responsable stock">
        <div class="sidebar-rail">
          <button class="rail-logo fullscreen-toggle" id="fullscreenToggleBtn" type="button" aria-label="Ouvrir en plein écran" title="Ouvrir en plein écran">
            ${icon('maximize-2')}
          </button>
        </div>
        <div class="sidebar-panel">
          <div class="sidebar-title">
            <strong>Smart Cut</strong>
            <small>Gestion des stocks</small>
          </div>
          <nav class="sidebar-nav">
            <button class="${state.activeView === 'stock-overview' ? 'active' : ''}" data-stock-view="stock-overview" type="button">${icon('layout-dashboard')}<span>Vue d'ensemble</span></button>
            <button class="${state.activeView === 'stock-inventory' ? 'active' : ''}" data-stock-view="stock-inventory" type="button">${icon('boxes')}<span>Inventaire</span></button>
            <button class="${state.activeView === 'stock-products' ? 'active' : ''}" data-stock-view="stock-products" type="button">${icon('package-search')}<span>Produits</span></button>
            <button class="${state.activeView === 'stock-movements' ? 'active' : ''}" data-stock-view="stock-movements" type="button">${icon('arrow-up-down')}<span>Mouvements</span></button>
            <button class="${state.activeView === 'stock-transfers' ? 'active' : ''}" data-stock-view="stock-transfers" type="button">${icon('arrow-right-left')}<span>Transferts</span></button>
            <button class="${state.activeView === 'stock-physical' ? 'active' : ''}" data-stock-view="stock-physical" type="button">${icon('clipboard-check')}<span>Inventaire physique</span></button>
            <button class="${state.activeView === 'stock-locations' ? 'active' : ''}" data-stock-view="stock-locations" type="button">${icon('warehouse')}<span>Magasins et dépôts</span></button>
            <button class="${state.activeView === 'stock-reports' ? 'active' : ''}" data-stock-view="stock-reports" type="button">${icon('chart-column')}<span>Rapports stock</span></button>
            <button id="sidebarLogoutBtn" type="button">${icon('log-out')}<span>Déconnexion</span></button>
          </nav>
        </div>
      </aside>
    `;
  }
  return `
    <aside class="cashier-sidebar" aria-label="Navigation caisse">
      <div class="sidebar-rail">
        <button class="rail-logo fullscreen-toggle" id="fullscreenToggleBtn" type="button" aria-label="Ouvrir en plein écran" title="Ouvrir en plein écran">
          ${icon('maximize-2')}
        </button>
      </div>
      <div class="sidebar-panel">
        <div class="sidebar-title">
          <strong>Smart Cut</strong>
          <small>Caisse boutique</small>
        </div>
        <nav class="sidebar-nav">
          <button id="cashierModeBtn" class="${state.activeView === 'register' ? 'active' : ''}" type="button">
            ${icon('shopping-cart')}
            <span>Caisse</span>
          </button>
          <button id="recentSalesBtn" class="${state.activeView === 'recent-sales' ? 'active' : ''}" type="button">
            ${icon('history')}
            <span>Récents</span>
          </button>
          <button id="sidebarLogoutBtn" type="button">
            ${icon('log-out')}
            <span>Déconnexion</span>
          </button>
        </nav>
      </div>
    </aside>
  `;
}

function renderHeader(selected, session) {
  const role = getRole(state.profile || {}) || 'caissier';
  const displayName = getDisplayName();
  const manager = isManager();
  const stockManager = isStockManager();
  return `
    <header class="cashier-header ${isBackOfficeRole() ? 'manager-header' : ''}">
      <div class="header-brand">
        <button class="sidebar-toggle" id="sidebarToggleBtn" type="button" aria-label="Afficher ou masquer le menu">${icon('panel-left')}</button>
        <span class="time-chip">
          ${icon('clock-3')}
          <strong>${escapeHtml(formatClockLabel())}</strong>
        </span>
        <div>
          <h1>${manager ? 'Espace Manager' : stockManager ? 'Espace Responsable stock' : 'Interface de Caisse'}</h1>
        </div>
      </div>
      <label class="top-search">
        ${icon('search')}
        <input id="searchInput" type="search" value="${escapeHtml(state.search)}" placeholder="${isBackOfficeRole() ? 'Recherche globale' : 'Rechercher par nom ou SKU'}" ${isBackOfficeRole() ? 'disabled' : ''}>
        <kbd>Ctrl + K</kbd>
      </label>
      <div class="header-actions">
        <div class="operator-chip">
          <span class="operator-avatar">${icon('user-round-check')}</span>
          <span>
            <small>${escapeHtml(role)}</small>
            <strong>${escapeHtml(displayName || 'Caissier')}</strong>
          </span>
          ${icon('chevron-down')}
        </div>
      </div>
    </header>
  `;
}

function renderStatusRail(selected, session) {
  const totalSales = toNumber(session?.totalSales);
  const saleCount = toNumber(session?.saleCount);
  return `
    <section class="status-rail">
      <article class="${session ? 'online' : 'standby'}">
        <span>${icon(session ? 'radio-tower' : 'power')}</span>
        <div>
          <small>Statut</small>
          <strong>${session ? 'En service' : 'En attente'}</strong>
        </div>
      </article>
      <article>
        <span>${icon('store')}</span>
        <div>
          <small>Point de vente</small>
          <strong>${escapeHtml(selected?.name || 'Non choisi')}</strong>
        </div>
      </article>
      <article>
        <span>${icon('receipt-text')}</span>
        <div>
          <small>Ventes de la session</small>
          <strong>${escapeHtml(saleCount)} · ${escapeHtml(formatMoney(totalSales))}</strong>
        </div>
      </article>
      <article>
        <span>${icon('clock-3')}</span>
        <div>
          <small>Ouverte depuis</small>
          <strong>${session ? escapeHtml(formatDate(session.openedAt)) : 'Session requise'}</strong>
        </div>
      </article>
    </section>
  `;
}

function renderSellingScreen(selected, session) {
  if (state.activeView === 'recent-sales') return renderRecentSalesScreen();

  const items = getCatalogItems();
  const totals = getCartTotals();
  const displayTotals = getCartTotals();
  const productCount = items.length;
  return `
    <main class="pos-workspace">
      <section class="pos-catalog">
        <div class="pos-catalog-head">
          <div>
            <p class="eyebrow">Catalogue</p>
            <h2>Produits disponibles</h2>
          </div>
          <div class="catalog-meta">
            <span>${icon('map-pin')} ${escapeHtml(selected?.name || 'Catalogue global')}</span>
            <span>${icon('package-check')} ${escapeHtml(productCount)} produit(s)</span>
          </div>
        </div>
        ${renderCategoryFilters()}
        <div class="products-grid">
          ${items.length ? items.map(renderProductCard).join('') : renderEmptyProducts()}
        </div>
        <section class="pos-bottom-tools">
          ${renderPaymentCard(displayTotals)}
        </section>
      </section>
      <aside class="pos-cart-panel ${state.lastSale ? 'has-receipt' : ''}">
        ${state.lastSale ? renderSaleSuccessCard() : ''}
        ${renderCartCard(displayTotals)}
        <div class="session-footer">
          <button class="ghost-action" id="refreshBtn" type="button">${icon('refresh-cw')} Actualiser</button>
          <span class="automatic-session-note">${icon('zap')} Caisse ouverte automatiquement</span>
        </div>
      </aside>
    </main>
  `;
}

function renderRecentSalesScreen() {
  const sales = state.sales
    .filter((sale) => sale.status !== 'failed')
    .sort((a, b) => getDateMs(b.createdAt) - getDateMs(a.createdAt));
  const visibleSales = sales.slice(0, 25);
  const total = visibleSales.reduce((sum, sale) => sum + toNumber(sale.total), 0);

  return `
    <main class="recent-sales-page">
      <header class="recent-sales-page-head">
        <div>
          <p class="eyebrow">Historique caisse</p>
          <h2>Ventes récentes</h2>
          <p class="recent-sales-page-subtitle">Retrouvez les dernières ventes enregistrées depuis cette caisse.</p>
        </div>
        <button class="secondary-action recent-back-btn" id="backToRegisterBtn" type="button">
          ${icon('arrow-left')} Retour à la caisse
        </button>
      </header>
      <section class="recent-sales-summary" aria-label="Résumé des ventes récentes">
        <article>
          <span>${icon('receipt-text')}</span>
          <div><small>Ventes affichées</small><strong>${escapeHtml(visibleSales.length)}</strong></div>
        </article>
        <article>
          <span>${icon('banknote')}</span>
          <div><small>Total encaissé</small><strong>${escapeHtml(formatMoney(total))}</strong></div>
        </article>
      </section>
      <section class="recent-sales-page-card">
        <div class="recent-sales-page-card-head">
          <div>
            <h3>Dernières transactions</h3>
            <p>Les ventes les plus récentes apparaissent en premier.</p>
          </div>
          <button class="ghost-action" id="refreshRecentSalesBtn" type="button">${icon('refresh-cw')} Actualiser</button>
        </div>
        <div class="recent-sales-page-list">
          ${visibleSales.length ? visibleSales.map((sale) => `
            <article class="recent-sale-row">
              <span class="recent-sale-status">${icon(sale.status === 'completed' ? 'check' : 'clock-3')}</span>
              <div class="recent-sale-main">
                <strong>${escapeHtml(sale.reference || 'Vente caisse')}</strong>
                <small>${escapeHtml(formatDate(sale.createdAt))} · ${escapeHtml(sale.customerName || 'Client comptoir')}</small>
              </div>
              <div class="recent-sale-meta">
                <small>${escapeHtml(sale.itemCount || 0)} article(s) · ${escapeHtml(formatPaymentMethod(sale.paymentMethod))}</small>
                <b>${escapeHtml(formatMoney(sale.total))}</b>
              </div>
            </article>
          `).join('') : `
            <div class="recent-sales-page-empty">
              ${icon('receipt-text')}
              <strong>Aucune vente récente</strong>
              <span>Les ventes validées depuis cette caisse apparaîtront ici.</span>
            </div>
          `}
        </div>
      </section>
    </main>
  `;
}

function renderCategoryFilters() {
  const categories = getCatalogCategories();
  const active = state.activeCategory || 'all';
  return `
    <section class="category-strip" aria-label="Filtres par catégorie">
      <button class="${active === 'all' ? 'active' : ''}" data-category="all" type="button">
        ${icon('layout-grid')} Tous
      </button>
      ${categories.map((category) => `
        <button class="${active === category.id ? 'active' : ''}" data-category="${escapeHtml(category.id)}" type="button">
          <span>${escapeHtml(category.label)}</span>
        </button>
      `).join('')}
    </section>
  `;
}

function renderRecentSalesDock(selected, session) {
  const sales = getRecentSales(selected, session);
  return `
    <section class="recent-sales-dock">
      <div class="recent-sales-head">
        <span>${icon('activity')} Ventes récentes</span>
        <small>${escapeHtml(sales.length)} affichée(s)</small>
      </div>
      <div class="recent-sales-list">
        ${sales.length ? sales.map((sale) => `
          <article>
            <span>${icon(sale.status === 'completed' ? 'check' : 'loader-circle')}</span>
            <div>
              <strong>${escapeHtml(sale.reference || 'Vente caisse')}</strong>
              <small>${escapeHtml(formatDate(sale.createdAt))} · ${escapeHtml(formatPaymentMethod(sale.paymentMethod))}</small>
            </div>
            <b>${escapeHtml(formatMoney(sale.total))}</b>
          </article>
        `).join('') : `
          <div class="recent-sales-empty">
            ${icon('receipt-text')}
            <span>Aucune vente récente pour cette session.</span>
          </div>
        `}
      </div>
    </section>
  `;
}

function renderSaleSuccessCard() {
  const sale = state.lastSale || {};
  return `
    <section class="sale-success-card">
      <div class="sale-success-hero">
        <span>${icon('check-check')}</span>
        <div>
          <small>Dernière vente validée</small>
          <strong>${escapeHtml(sale.reference || 'Vente confirmée')}</strong>
          <em>${escapeHtml(formatDate(sale.createdAt))}</em>
        </div>
      </div>
      <div class="sale-receipt-grid">
        <span><small>Client</small><b>${escapeHtml(sale.customerName || 'Client comptoir')}</b></span>
        <span><small>Paiement</small><b>${escapeHtml(formatPaymentMethod(sale.paymentMethod))}</b></span>
        <span><small>Articles</small><b>${escapeHtml(sale.itemCount || 0)}</b></span>
        <span class="highlight"><small>Total</small><b>${escapeHtml(formatMoney(sale.total))}</b></span>
        <span><small>Reçu</small><b>${escapeHtml(formatMoney(sale.amountPaid))}</b></span>
        <span><small>Monnaie</small><b>${escapeHtml(formatMoney(sale.changeDue))}</b></span>
      </div>
      <div class="sale-success-actions">
        <button class="ghost-action wide" id="printReceiptBtn" type="button">${icon('printer')} Imprimer le reçu</button>
        <button class="ghost-action wide new-sale-action" id="newSaleBtn" type="button">${icon('shopping-bag')} Nouvelle vente</button>
      </div>
    </section>
  `;
}

function renderCashierCoach(totals, productCount) {
  const hasCart = state.cart.length > 0;
  const isReady = hasCart && totals.due <= 0 && totals.total > 0;
  const title = !productCount
    ? 'Aucun stock vendable'
    : !hasCart
      ? 'Cherchez un produit'
      : isReady
        ? 'Prêt pour validation'
        : 'Complétez le paiement';
  const detail = !productCount
    ? 'Changez de magasin ou actualisez le stock avant de vendre.'
    : !hasCart
      ? 'Recherchez un produit par nom ou SKU, puis touchez Ajouter pour le mettre au panier.'
      : isReady
        ? 'Le panier et le montant reçu sont cohérents. Vous pouvez terminer la vente.'
        : `Il reste ${formatMoney(totals.due)} à recevoir avant validation.`;
  const iconName = !productCount ? 'package-x' : !hasCart ? 'search' : isReady ? 'badge-check' : 'wallet-cards';
  const tone = !productCount ? 'danger' : isReady ? 'ready' : hasCart ? 'warning' : 'idle';
  return `
    <section class="cash-flow-coach ${tone}">
      <span class="coach-orb">${icon(iconName)}</span>
      <div class="coach-copy">
        <small>Assistant caisse</small>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(detail)}</p>
      </div>
      <div class="coach-metrics">
        <span><b>${escapeHtml(totals.itemCount)}</b><small>article(s)</small></span>
        <span><b>${escapeHtml(formatMoney(totals.total))}</b><small>total</small></span>
        <span><b>${escapeHtml(formatMoney(totals.amountPaid))}</b><small>reçu</small></span>
      </div>
    </section>
  `;
}

function renderProductCard(item) {
  const cartItem = state.cart.find((entry) => entry.key === item.key);
  const quantityInCart = toNumber(cartItem?.quantity);
  const remainingQty = Math.max(0, toNumber(item.availableQty) - quantityInCart);
  const stockTone = remainingQty <= 0 ? 'maxed' : remainingQty <= 3 ? 'low' : 'ok';
  const stockLabel = remainingQty <= 0 ? 'Rupture de stock' : remainingQty <= 3 ? `Stock faible · ${remainingQty}` : `${remainingQty} en stock`;
  return `
    <article class="product-card ${quantityInCart ? 'in-cart' : ''} ${stockTone === 'maxed' ? 'maxed' : ''}">
      <div class="product-image">
        ${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.productName)}">` : `<em class="no-image">${icon('image-off')} Aucune image</em>`}
        <span class="stock-chip ${stockTone}">${icon(stockTone === 'low' ? 'alert-triangle' : stockTone === 'maxed' ? 'circle-stop' : 'boxes')} ${escapeHtml(stockLabel)}</span>
      </div>
      <div class="product-copy">
        <strong title="${escapeHtml(item.productName)}">${escapeHtml(item.productName)}</strong>
        <small>${escapeHtml([item.category, item.variantLabel, item.sku].filter(Boolean).join(' · ') || 'Produit simple')}</small>
      </div>
      <div class="product-price">
        <b>${escapeHtml(formatMoney(item.unitPrice))}</b>
      </div>
      <button class="add-line-btn" data-add="${escapeHtml(item.key)}" type="button" ${remainingQty <= 0 ? 'disabled' : ''}>
        ${icon(quantityInCart ? 'plus' : 'shopping-cart')} ${quantityInCart ? `+ (${escapeHtml(quantityInCart)})` : 'Ajouter'}
      </button>
    </article>
  `;
}

function renderCartShelf(totals) {
  const hasCart = state.cart.length > 0;
  return `
    <section class="cart-shelf ${hasCart ? 'active' : 'empty'}">
      <span>${icon(hasCart ? 'shopping-basket' : 'search')}</span>
      <div>
        <small>${hasCart ? 'Panier en cours' : 'Panier disponible'}</small>
        <strong>${hasCart ? `${formatMoney(totals.subtotal)} avant remise` : 'Prêt à recevoir un produit'}</strong>
      </div>
      <b>${escapeHtml(totals.itemCount)} article(s)</b>
    </section>
  `;
}

function renderEmptyProducts() {
  const selected = getSelectedLocation();
  const activeCategory = state.activeCategory || 'all';
  const hasLocations = getActiveLocations().length > 0;
  const allSellableItems = getAllCatalogItems({ applyFilters: false });
  const locationBalances = allSellableItems;
  const sellableBalances = allSellableItems;
  const hasSearch = Boolean(normalizeText(state.search));
  const reason = !hasLocations
    ? 'Aucun point de vente actif n’est configuré.'
    : !selected
      ? 'Aucun magasin n’est sélectionné.'
      : !locationBalances.length
        ? `Aucun stock n’est rattaché à ${selected.name || 'ce magasin'}.`
        : !sellableBalances.length
          ? `Le stock de ${selected.name || 'ce magasin'} est vide ou indisponible.`
          : activeCategory !== 'all'
            ? 'Aucun produit disponible dans cette catégorie.'
            : hasSearch
              ? 'Aucun produit ne correspond à cette recherche.'
              : 'Aucun produit vendable disponible pour le moment.';
  return `
    <div class="empty-products">
      ${icon('package-x')}
      <strong>Aucun produit trouvé</strong>
      <span>${escapeHtml(reason)}</span>
      <div class="empty-actions">
        <button class="ghost-action" id="refreshEmptyProductsBtn" type="button">${icon('refresh-cw')} Actualiser</button>
      </div>
    </div>
  `;
}

function renderCartLines() {
  return `
    <div class="cart-list">
      ${state.cart.length ? state.cart.map((item, index) => `
        <article class="cart-item">
          <span class="cart-line-index">${escapeHtml(index + 1)}</span>
          <span class="cart-thumb">
            ${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : icon('image-off')}
          </span>
          <div>
            <strong>${escapeHtml(item.productName)}</strong>
            <small>${escapeHtml([item.variantLabel, item.sku].filter(Boolean).join(' · ') || 'Produit simple')}</small>
            <span>${escapeHtml(formatMoney(item.unitPrice))} / unité</span>
            <em class="cart-stock-meta">${icon('boxes')} ${escapeHtml(item.availableQty)} disponible(s) · ${escapeHtml(item.quantity)} sélectionné(s)</em>
          </div>
          <b class="line-total">${escapeHtml(formatMoney(toNumber(item.unitPrice) * toNumber(item.quantity)))}</b>
          <div class="qty-control">
            <button data-qty="${escapeHtml(item.key)}" data-delta="-1" type="button">-</button>
            <input data-qty-input="${escapeHtml(item.key)}" type="number" min="1" max="${escapeHtml(item.availableQty)}" value="${escapeHtml(item.quantity)}">
            <button data-qty="${escapeHtml(item.key)}" data-delta="1" type="button">+</button>
          </div>
          <button class="icon-action danger" data-remove="${escapeHtml(item.key)}" type="button">${icon('x')}</button>
        </article>
      `).join('') : `<div class="empty-cart">${icon('shopping-bag')}<strong>Panier prêt</strong><span>Recherchez un produit par nom ou SKU, puis ajoutez-le au panier.</span></div>`}
    </div>
  `;
}

function renderCartCard(totals) {
  return `
    <div class="cart-card cart-card-bottom">
      <div class="cart-head">
        <div>
          <h2>${icon('shopping-cart')} Panier</h2>
          <small class="cart-count-badge">${escapeHtml(totals.itemCount)}</small>
        </div>
        <button class="tiny-action danger cart-clear-btn" id="clearCartBtn" type="button" ${state.cart.length ? '' : 'disabled'}>${icon('trash-2')} Vider</button>
      </div>
      ${renderCartLines()}
    </div>
  `;
}

function renderClientPicker() {
  const selectedClient = state.clients.find((client) => client.id === state.selectedClientId);
  const filteredClients = getFilteredClients();
  return `
    <section class="client-picker">
      <div class="client-picker-head">
        <span>${icon('user-round-search')}</span>
        <div>
          <small>Client</small>
          <strong>${selectedClient ? escapeHtml(getClientName(selectedClient)) : 'Client comptoir'}</strong>
        </div>
        ${selectedClient ? `<button class="tiny-action" id="clearClientBtn" type="button">${icon('x')} Retirer</button>` : ''}
      </div>
      <label>
        <span>Rechercher un client existant</span>
        <input id="clientSearchInput" type="search" value="${escapeHtml(state.clientSearch)}" placeholder="Nom, téléphone ou email...">
      </label>
      ${state.clientSearch || selectedClient ? `
        <div class="client-results">
          ${filteredClients.length ? filteredClients.map((client) => `
            <button class="${client.id === state.selectedClientId ? 'active' : ''}" data-client="${escapeHtml(client.id)}" type="button">
              ${icon('user-round')}
              <span>
                <strong>${escapeHtml(getClientName(client) || 'Client sans nom')}</strong>
                <small>${escapeHtml([getClientPhone(client), client.email].filter(Boolean).join(' · ') || 'Aucune coordonnée')}</small>
              </span>
            </button>
          `).join('') : `<span class="client-empty">${icon('user-x')} Aucun client trouvé. La vente peut rester en client comptoir.</span>`}
        </div>
      ` : ''}
      <label>
        <span>Nom client libre</span>
        <input id="customerNameInput" type="text" value="${escapeHtml(state.customerName)}" placeholder="Client comptoir">
      </label>
      ${state.customerPhone ? `<small class="selected-client-phone">${icon('phone')} ${escapeHtml(state.customerPhone)}</small>` : ''}
    </section>
  `;
}

function renderNumericPad() {
  const keys = ['7', '8', '9', 'backspace', '4', '5', '6', 'clear', '1', '2', '3', 'minus', '0', '.', 'ok', 'plus'];
  const labels = {
    backspace: icon('delete'),
    clear: '×',
    minus: '−',
    plus: '+',
    ok: 'OK',
  };
  return `
    <div class="pos-tool-card numpad-card">
      <div class="numpad-grid">
        ${keys.map((key) => `
          <button class="${key === 'ok' ? 'primary' : ''}" data-numpad="${escapeHtml(key)}" type="button">
            ${labels[key] || escapeHtml(key)}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderShortcutActions() {
  return `
    <section class="shortcut-card">
      <div class="shortcut-title">${icon('zap')} <strong>Raccourcis</strong></div>
      <div class="shortcut-grid">
        <button type="button" data-discount-mode="percent">${icon('percent')} Remise (%)</button>
        <button type="button" data-discount-mode="fixed">${icon('circle-dollar-sign')} Remise HTG</button>
        <button type="button" data-shortcut-action="note">${icon('message-square-text')} Note</button>
        <button type="button" data-shortcut-action="manual-price">${icon('tag')} Prix manuel</button>
        <button type="button" data-shortcut-action="more">${icon('ellipsis')} Plus d’actions</button>
      </div>
    </section>
  `;
}

function getPaymentAction(totals) {
  return {
    disabled: !state.cart.length || totals.due > 0,
    label: totals.due > 0 ? `Paiement incomplet · ${formatMoney(totals.due)} restant` : 'Finaliser la vente',
  };
}

function renderPaymentTotals(totals) {
  return `
    <div><span>Total des produits</span><strong>${escapeHtml(formatMoney(totals.subtotal))}</strong></div>
    <div><span>Rabais</span><strong>- ${escapeHtml(formatMoney(totals.discount))}</strong></div>
    ${totals.tax > 0 ? `<div><span>Taxes</span><strong>${escapeHtml(formatMoney(totals.tax))}</strong></div>` : ''}
    <div class="grand"><span>Total à payer</span><strong>${escapeHtml(formatMoney(totals.total))}</strong></div>
    <div><span>Monnaie à rendre</span><strong>${escapeHtml(formatMoney(totals.changeDue))}</strong></div>
  `;
}

function syncPaymentBar() {
  const totals = getCartTotals();
  const paymentCard = document.querySelector('.pos-bottom-tools .payment-card');
  const totalsCard = paymentCard?.querySelector(':scope > .totals-card');
  if (totalsCard) totalsCard.innerHTML = renderPaymentTotals(totals);

  const settlement = paymentCard?.querySelector(':scope > .settlement-strip');
  if (settlement) {
    settlement.className = `settlement-strip ${totals.due > 0 ? 'due' : 'ready'}`;
    settlement.innerHTML = `
      <span>${icon(totals.due > 0 ? 'alert-circle' : 'badge-check')}</span>
      <div>
        <strong>${totals.due > 0 ? 'Montant reçu insuffisant' : 'Prêt à encaisser'}</strong>
        <small>${totals.due > 0 ? `Reste à payer: ${escapeHtml(formatMoney(totals.due))}` : `Monnaie à rendre: ${escapeHtml(formatMoney(totals.changeDue))}`}</small>
      </div>
    `;
  }

  const checkoutButton = document.getElementById('completeSaleBtn');
  if (checkoutButton) {
    const action = getPaymentAction(totals);
    checkoutButton.disabled = action.disabled;
    checkoutButton.innerHTML = `${icon(action.disabled ? 'lock-keyhole' : 'check-circle-2')} ${escapeHtml(action.label)}`;
    refreshIcons();
  }
}

function renderPaymentCard(totals) {
  state.paymentMethod = 'cash';
  const action = getPaymentAction(totals);
  return `
    <div class="payment-card">
      <div class="payment-head">
        <span>${icon('banknote')}</span>
        <div>
          <p class="eyebrow">Paiement</p>
          <h2>Encaissement</h2>
        </div>
      </div>
      <div class="payment-inputs received-fields">
        <label>
          <span>Montant reçu</span>
          <input id="amountPaidInput" type="number" min="0" step="1" placeholder="Montant remis par le client" value="${state.amountPaid > 0 ? escapeHtml(state.amountPaid) : ''}">
        </label>
      </div>
      <div class="payment-inputs discount-fields">
        <label>
          <span>Rabais (%)</span>
          <div class="discount-control">
            <input id="discountInput" type="number" min="0" max="100" step="0.01" placeholder="0" value="${state.discount > 0 ? escapeHtml(state.discount) : ''}" ${state.discountAuthorized ? '' : 'readonly'} aria-describedby="discountAuthHint">
            <button class="discount-authorize-btn ${state.discountAuthorized ? 'authorized' : ''}" id="openDiscountAuthorizationBtn" type="button">
              ${icon(state.discountAuthorized ? 'shield-check' : 'lock-keyhole')}
              <span>${state.discountAuthorized ? 'Autorisé' : 'Autoriser'}</span>
            </button>
          </div>
          <small class="discount-auth-hint" id="discountAuthHint">${state.discountAuthorized ? 'Rabais autorisé par un administrateur.' : 'Coordonnées administrateur requises.'}</small>
        </label>
      </div>
      <div class="totals-card">
        ${renderPaymentTotals(totals)}
      </div>
      <div class="settlement-strip ${totals.due > 0 ? 'due' : 'ready'}">
        <span>${icon(totals.due > 0 ? 'alert-circle' : 'badge-check')}</span>
        <div>
          <strong>${totals.due > 0 ? 'Montant reçu insuffisant' : 'Prêt à encaisser'}</strong>
          <small>${totals.due > 0 ? `Reste à payer: ${escapeHtml(formatMoney(totals.due))}` : `Monnaie à rendre: ${escapeHtml(formatMoney(totals.changeDue))}`}</small>
        </div>
      </div>
      <div class="receipt-preview">
        <div class="receipt-preview-head">
          <span>${icon('receipt')} Aperçu reçu</span>
          <b>${escapeHtml(totals.itemCount)} article(s)</b>
        </div>
        <div class="receipt-preview-body">
          <span>Client</span><strong>${escapeHtml(normalizeText(state.customerName) || 'Client comptoir')}</strong>
          <span>Paiement</span><strong>Liquide</strong>
          <span>Total final</span><strong>${escapeHtml(formatMoney(totals.total))}</strong>
        </div>
      </div>
      <div class="form-error" id="saleError" hidden></div>
      <button class="primary-action wide checkout-btn" id="completeSaleBtn" type="button" ${action.disabled ? 'disabled' : ''}>${icon(action.disabled ? 'lock-keyhole' : 'check-circle-2')} ${escapeHtml(action.label)}</button>
    </div>
  `;
}

function renderTenderDashboard(totals) {
  const balanceLabel = totals.due > 0 ? 'Reste à payer' : 'Monnaie';
  const balanceValue = totals.due > 0 ? totals.due : totals.changeDue;
  return `
    <section class="tender-dashboard ${totals.due > 0 ? 'waiting' : 'ready'}">
      <span class="tender-gauge">
        ${icon(totals.due > 0 ? 'wallet-cards' : 'badge-check')}
      </span>
      <div class="tender-main">
        <small>${totals.due > 0 ? 'Paiement à compléter' : 'Paiement prêt'}</small>
        <strong>${escapeHtml(formatMoney(totals.total))}</strong>
      </div>
      <div class="tender-split">
        <span><small>Reçu</small><b>${escapeHtml(formatMoney(totals.amountPaid))}</b></span>
        <span><small>${escapeHtml(balanceLabel)}</small><b>${escapeHtml(formatMoney(balanceValue))}</b></span>
      </div>
    </section>
  `;
}

function renderCloseSessionModal(session) {
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="closeSessionTitle">
      <section class="close-session-modal">
        <button class="icon-action modal-close" id="cancelCloseSessionBtn" type="button" aria-label="Annuler la fermeture">${icon('x')}</button>
        <span class="modal-orb">${icon('lock-keyhole')}</span>
        <p class="eyebrow">Fermeture sécurisée</p>
        <h2 id="closeSessionTitle">Fermer la caisse</h2>
        <p class="soft-text">Entrez le montant compté physiquement dans la caisse. La session sera ensuite clôturée pour ce point de vente.</p>
        <div class="modal-session-summary">
          <span><small>Session</small><b>${escapeHtml(session.reference || session.id)}</b></span>
          <span><small>Ventes</small><b>${escapeHtml(session.saleCount || 0)}</b></span>
          <span><small>Total</small><b>${escapeHtml(formatMoney(session.totalSales))}</b></span>
        </div>
        <label>
          <span>Montant compté en caisse</span>
          <input id="closingAmountInput" type="number" min="0" step="1" value="${escapeHtml(state.closingAmount)}" placeholder="Ex: 2500" autofocus>
        </label>
        <div class="modal-actions">
          <button class="ghost-action wide" id="cancelCloseSessionBtn2" type="button">${icon('arrow-left')} Annuler</button>
          <button class="danger-action wide" id="confirmCloseSessionBtn" type="button">${icon('lock')} Confirmer la fermeture</button>
        </div>
      </section>
    </div>
  `;
}

function renderDiscountAuthorizationModal() {
  return `
    <div class="modal-backdrop discount-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="discountAuthorizationTitle">
      <form class="discount-authorization-modal" id="discountAuthorizationForm">
        <button class="icon-action modal-close" id="closeDiscountAuthorizationBtn" type="button" aria-label="Fermer">${icon('x')}</button>
        <span class="discount-modal-icon">${icon('shield-check')}</span>
        <p class="eyebrow">Autorisation requise</p>
        <h2 id="discountAuthorizationTitle">Appliquer un rabais</h2>
        <p class="discount-modal-copy">Seul un administrateur peut autoriser une remise sur cette vente.</p>
        <label>
          <span>Rabais souhaité (%)</span>
          <input id="discountRequestedInput" type="number" min="0.01" max="100" step="0.01" value="${escapeHtml(state.discountRequested || '')}" placeholder="Ex. 10" required autofocus>
        </label>
        <label>
          <span>Email administrateur</span>
          <input id="discountAdminEmailInput" type="email" autocomplete="username" value="${escapeHtml(state.discountAdminEmail)}" placeholder="admin@exemple.com" required>
        </label>
        <label>
          <span>Mot de passe administrateur</span>
          <input id="discountAdminPasswordInput" type="password" autocomplete="current-password" placeholder="Mot de passe" required>
        </label>
        ${state.discountAuthError ? `<div class="form-error">${escapeHtml(state.discountAuthError)}</div>` : ''}
        <div class="discount-modal-actions">
          <button class="secondary-action" id="cancelDiscountAuthorizationBtn" type="button">Annuler</button>
          <button class="primary-action" id="authorizeDiscountBtn" type="submit">${icon('shield-check')} Autoriser le rabais</button>
        </div>
      </form>
    </div>
  `;
}

let noticeTimer = null;

function showNotice(type, title, message = '') {
  if (String(message).endsWith(' est dans le panier.')) return;
  if (noticeTimer) window.clearTimeout(noticeTimer);
  state.notice = {
    type,
    title,
    message,
  };
  noticeTimer = window.setTimeout(() => {
    state.notice = null;
    renderApp();
  }, 2800);
  if (state.user && !state.loading) renderApp();
}

function renderNotice() {
  if (!state.notice) return '';
  const toneIcon = {
    success: 'badge-check',
    warning: 'alert-triangle',
    danger: 'circle-alert',
    info: 'sparkles',
  }[state.notice.type] || 'sparkles';
  return `
    <aside class="smart-toast ${escapeHtml(state.notice.type)}" role="status" aria-live="polite">
      <span>${icon(toneIcon)}</span>
      <div>
        <strong>${escapeHtml(state.notice.title)}</strong>
        ${state.notice.message ? `<small>${escapeHtml(state.notice.message)}</small>` : ''}
      </div>
      <button class="toast-close" id="dismissNoticeBtn" type="button" aria-label="Fermer le message">${icon('x')}</button>
    </aside>
  `;
}

function bindAppEvents() {
  document.getElementById('logoutBtn')?.addEventListener('click', async () => signOut(auth));
  document.getElementById('sidebarLogoutBtn')?.addEventListener('click', async () => signOut(auth));
  const fullscreenButton = document.getElementById('fullscreenToggleBtn');
  const syncFullscreenButton = () => {
    const active = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    const label = active ? 'Quitter le plein écran' : 'Ouvrir en plein écran';
    if (!fullscreenButton) return;
    fullscreenButton.setAttribute('aria-label', label);
    fullscreenButton.setAttribute('title', label);
    fullscreenButton.innerHTML = icon(active ? 'minimize-2' : 'maximize-2');
    refreshIcons();
  };
  document.onfullscreenchange = syncFullscreenButton;
  document.onwebkitfullscreenchange = syncFullscreenButton;
  fullscreenButton?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await document.webkitExitFullscreen?.();
      } else {
        const appShell = document.documentElement;
        if (appShell.requestFullscreen) await appShell.requestFullscreen();
        else await appShell.webkitRequestFullscreen?.();
      }
      syncFullscreenButton();
    } catch (error) {
      console.warn('[SMART_CAISSE] Plein écran indisponible', error);
      showNotice('warning', 'Plein écran indisponible', 'Votre navigateur ne permet pas cette action.');
    }
  });
  syncFullscreenButton();
  document.getElementById('sidebarToggleBtn')?.addEventListener('click', () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    renderApp();
  });
  document.getElementById('managerPeriodSelect')?.addEventListener('change', (event) => {
    state.managerPeriod = event.target.value || '30';
    refreshManagerRegion();
  });
  document.getElementById('managerRefreshBtn')?.addEventListener('click', loadWorkspace);
  document.getElementById('stockPeriodSelect')?.addEventListener('change', (event) => {
    state.stockPeriod = event.target.value || '30';
    refreshStockRegion();
  });
  document.getElementById('stockRefreshBtn')?.addEventListener('click', loadWorkspace);
  document.getElementById('cashierModeBtn')?.addEventListener('click', () => {
    state.activeView = 'register';
    renderApp();
  });
  document.getElementById('recentSalesBtn')?.addEventListener('click', () => {
    state.activeView = 'recent-sales';
    renderApp();
  });
  document.getElementById('backToRegisterBtn')?.addEventListener('click', () => {
    state.activeView = 'register';
    renderApp();
  });
  document.getElementById('refreshRecentSalesBtn')?.addEventListener('click', loadWorkspace);
  document.getElementById('refreshEmptyProductsBtn')?.addEventListener('click', loadWorkspace);
  document.getElementById('dismissNoticeBtn')?.addEventListener('click', () => {
    if (noticeTimer) window.clearTimeout(noticeTimer);
    state.notice = null;
    renderApp();
  });
  document.getElementById('searchInput')?.addEventListener('input', (event) => {
    state.search = event.target.value || '';
    rerenderAndFocus('searchInput', state.search);
  });
  document.getElementById('searchInput')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitProductSearch();
  });
  document.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
    state.activeCategory = button.dataset.category || 'all';
    renderApp();
  }));
  if (typeof bindRegisterEvents === 'function') bindRegisterEvents();
  document.getElementById('printReceiptBtn')?.addEventListener('click', printLastReceipt);
  document.getElementById('newSaleBtn')?.addEventListener('click', () => {
    state.lastSale = null;
    state.search = '';
    renderApp();
    setTimeout(() => document.getElementById('searchInput')?.focus(), 0);
  });
  document.getElementById('refreshBtn')?.addEventListener('click', loadWorkspace);
  document.getElementById('closingAmountInput')?.addEventListener('input', (event) => {
    state.closingAmount = event.target.value || '';
  });
  document.getElementById('cancelCloseSessionBtn')?.addEventListener('click', cancelCloseSessionModal);
  document.getElementById('cancelCloseSessionBtn2')?.addEventListener('click', cancelCloseSessionModal);
}

function bindRegisterEvents() {
  if (root.dataset.registerEventsBound === 'true') return;
  root.dataset.registerEventsBound = 'true';

  root.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest('button');
    if (!target) return;

    const managerViewButton = target.closest('[data-manager-view]');
    if (managerViewButton) {
      state.activeView = managerViewButton.dataset.managerView || 'manager-overview';
      state.managerSearch = '';
      renderApp();
      return;
    }

    const stockViewButton = target.closest('[data-stock-view]');
    if (stockViewButton) {
      state.activeView = stockViewButton.dataset.stockView || 'stock-overview';
      state.stockSearch = '';
      renderApp();
      return;
    }

    const addButton = target.closest('[data-add]');
    if (addButton) {
      addCartItem(addButton.dataset.add);
      return;
    }

    const qtyButton = target.closest('[data-qty]');
    if (qtyButton) {
      updateQty(qtyButton.dataset.qty, Number(qtyButton.dataset.delta || 0));
      return;
    }

    const removeButton = target.closest('[data-remove]');
    if (removeButton) {
      removeItem(removeButton.dataset.remove);
      return;
    }

    if (target.closest('#openDiscountAuthorizationBtn')) {
      state.discountModalOpen = true;
      state.discountAuthError = '';
      state.discountRequested = state.discount > 0 ? state.discount : '';
      state.discountAdminEmail = '';
      renderApp();
      requestAnimationFrame(() => document.getElementById('discountRequestedInput')?.focus());
      return;
    }

    if (target.closest('#closeDiscountAuthorizationBtn') || target.closest('#cancelDiscountAuthorizationBtn')) {
      state.discountModalOpen = false;
      state.discountAuthError = '';
      renderApp();
      return;
    }

    if (target.closest('#clearCartBtn')) {
      if (!state.cart.length) return;
      if (!window.confirm('Voulez-vous vider le panier ?')) return;
      state.cart = [];
      state.amountPaid = 0;
      state.keypadBuffer = '';
      state.discount = 0;
      state.discountType = 'percent';
      state.discountAuthorized = false;
      refreshRegisterUI('', true);
      return;
    }

    const tenderButton = target.closest('[data-tender]');
    if (tenderButton) {
      applyTenderShortcut(tenderButton.dataset.tender);
      return;
    }

    const numpadButton = target.closest('[data-numpad]');
    if (numpadButton) {
      applyNumpadKey(numpadButton.dataset.numpad);
      return;
    }

    const discountModeButton = target.closest('[data-discount-mode]');
    if (discountModeButton) {
      state.discountType = discountModeButton.dataset.discountMode;
      renderApp();
      requestAnimationFrame(() => document.getElementById('discountInput')?.focus());
      return;
    }

    const shortcutButton = target.closest('[data-shortcut-action]');
    if (shortcutButton) {
      showNotice('info', 'Raccourci disponible bientôt', 'Cette action sera ajoutée dans une prochaine version.');
      return;
    }

    if (target.closest('#completeSaleBtn')) {
      completeSale();
      return;
    }

    if (target.closest('#refreshBtn')) {
      loadWorkspace();
    }
  });

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches('[data-qty-input]')) {
      setQty(target.dataset.qtyInput, target.value);
      return;
    }
    if (target.matches('#discountTypeSelect')) {
      state.discountType = target.value;
      renderApp();
      return;
    }
    if (target.matches('#discountInput')) {
      if (!state.discountAuthorized) return;
      state.discount = Math.max(0, toNumber(target.value));
      syncPaymentBar();
    }
  });

  root.addEventListener('input', (event) => {
    const target = event.target;
    if (target.matches('#managerSearchInput')) {
      state.managerSearch = target.value || '';
      const cursor = target.selectionStart;
      refreshManagerRegion();
      requestAnimationFrame(() => {
        const input = document.getElementById('managerSearchInput');
        input?.focus();
        if (input && cursor !== null) input.setSelectionRange(cursor, cursor);
      });
      return;
    }
    if (target.matches('#stockSearchInput')) {
      state.stockSearch = target.value || '';
      const cursor = target.selectionStart;
      refreshStockRegion();
      requestAnimationFrame(() => {
        const input = document.getElementById('stockSearchInput');
        input?.focus();
        if (input && cursor !== null) input.setSelectionRange(cursor, cursor);
      });
      return;
    }
    if (target.matches('#discountRequestedInput')) {
      state.discountRequested = target.value || '';
      return;
    }
    if (target.matches('#discountAdminEmailInput')) {
      state.discountAdminEmail = target.value || '';
      return;
    }
    if (target.matches('#discountInput')) {
      if (!state.discountAuthorized) return;
      state.discount = Math.min(100, Math.max(0, toNumber(target.value)));
      syncPaymentBar();
      return;
    }
    if (!target.matches('#amountPaidInput')) return;
    state.amountPaid = Math.max(0, toNumber(target.value));
    syncPaymentBar();
  });

  root.addEventListener('submit', (event) => {
    if (event.target.matches('#discountAuthorizationForm')) authorizeDiscount(event);
  });
}

function refreshRegisterUI(changedKey = '', refreshProducts = false) {
  if (state.activeView !== 'register' || !document.querySelector('.pos-workspace')) {
    renderApp();
    return;
  }

  const totals = getCartTotals();
  const cartPanel = document.querySelector('.pos-cart-panel');
  if (cartPanel) {
    cartPanel.className = `pos-cart-panel ${state.lastSale ? 'has-receipt' : ''}`;
    cartPanel.innerHTML = `
      ${state.lastSale ? renderSaleSuccessCard() : ''}
      ${renderCartCard(totals)}
      <div class="session-footer">
        <button class="ghost-action" id="refreshBtn" type="button">${icon('refresh-cw')} Actualiser</button>
        <span class="automatic-session-note">${icon('zap')} Caisse ouverte automatiquement</span>
      </div>
    `;
  }

  const paymentTools = document.querySelector('.pos-bottom-tools');
  if (paymentTools) paymentTools.innerHTML = renderPaymentCard(totals);

  const productsGrid = document.querySelector('.products-grid');
  if (productsGrid) {
    if (refreshProducts) {
      const items = getCatalogItems();
      productsGrid.innerHTML = items.length ? items.map(renderProductCard).join('') : renderEmptyProducts();
    } else if (changedKey) {
      const item = getCatalogItems().find((entry) => entry.key === changedKey);
      const oldCard = [...productsGrid.querySelectorAll('[data-add]')]
        .find((button) => button.dataset.add === changedKey)
        ?.closest('.product-card');
      if (item && oldCard) oldCard.outerHTML = renderProductCard(item);
    }
  }

  refreshIcons();
}

async function authorizeDiscount(event) {
  event.preventDefault();
  const form = event.target;
  const percent = Math.min(100, Math.max(0, toNumber(form.querySelector('#discountRequestedInput')?.value)));
  const email = normalizeText(form.querySelector('#discountAdminEmailInput')?.value).toLowerCase();
  const password = form.querySelector('#discountAdminPasswordInput')?.value || '';
  const submitButton = form.querySelector('#authorizeDiscountBtn');

  state.discountRequested = percent || '';
  state.discountAdminEmail = email;
  state.discountAuthError = '';
  if (!percent || percent <= 0 || percent > 100 || !email || !password) {
    state.discountAuthError = 'Entrez un pourcentage valide et les coordonnées de l’administrateur.';
    renderApp();
    return;
  }

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = `${icon('loader-circle')} Vérification...`;
    refreshIcons();
  }

  let secondaryUser = null;
  try {
    await adminCheckReadyPromise;
    const credential = await signInWithEmailAndPassword(adminCheckAuth, email, password);
    secondaryUser = credential.user;
    const profileSnap = await getDoc(doc(adminCheckDb, 'clients', secondaryUser.uid));
    const profile = profileSnap.exists() ? profileSnap.data() : {};
    const role = getRole(profile);
    if (role !== 'admin' && role !== 'administrateur') {
      throw new Error('Ce compte ne possède pas les droits administrateur.');
    }

    await signOut(adminCheckAuth);
    state.discountAuthorized = true;
    state.discountType = 'percent';
    state.discount = percent;
    state.discountModalOpen = false;
    state.discountAdminEmail = '';
    state.discountRequested = '';
    state.discountAuthError = '';
    renderApp();
  } catch (error) {
    if (secondaryUser || adminCheckAuth.currentUser) await signOut(adminCheckAuth).catch(() => null);
    state.discountAuthError = error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password'
      ? 'Email ou mot de passe administrateur incorrect.'
      : error?.message || 'Autorisation administrateur impossible.';
    renderApp();
    requestAnimationFrame(() => document.getElementById('discountAdminPasswordInput')?.focus());
  }
}

function rerenderAndFocus(inputId, value = '') {
  const valueLength = String(value || '').length;
  renderApp();
  requestAnimationFrame(() => {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.focus();
    try {
      input.setSelectionRange(valueLength, valueLength);
    } catch (_) {}
  });
}

function openCloseSessionModal() {
  state.closeSessionModal = true;
  state.closingAmount = '';
  renderApp();
  setTimeout(() => document.getElementById('closingAmountInput')?.focus(), 0);
}

function cancelCloseSessionModal() {
  state.closeSessionModal = false;
  state.closingAmount = '';
  renderApp();
}

function submitProductSearch() {
  const queryValue = normalizeText(state.search).toLowerCase();
  const items = getCatalogItems();
  const first = items.find((item) => {
    const candidates = [item.sku, item.productName, item.variantLabel].filter(Boolean).map((value) => String(value).toLowerCase());
    return queryValue && candidates.includes(queryValue);
  }) || items[0];
  if (!first) {
    showNotice('warning', 'Produit introuvable', 'Aucun produit vendable ne correspond à cette recherche.');
    return;
  }
  state.search = '';
  addCartItem(first.key);
  setTimeout(() => document.getElementById('searchInput')?.focus(), 0);
}

function addCartItem(key) {
  const item = getCatalogItems().find((entry) => entry.key === key);
  if (!item) {
    showNotice('warning', 'Produit introuvable', 'Actualisez le catalogue ou vérifiez le nom/SKU du produit.');
    return;
  }
  state.lastSale = null;
  const existing = state.cart.find((entry) => entry.key === key);
  if (existing) {
    if (existing.quantity >= existing.availableQty) {
      showNotice('warning', 'Stock maximum atteint', `${item.productName} est déjà au maximum vendable.`);
      return;
    }
    existing.quantity = Math.min(existing.availableQty, existing.quantity + 1);
  } else {
    state.cart.push({ ...item, quantity: 1 });
  }
  refreshRegisterUI(key);
}

function updateQty(key, delta) {
  const item = state.cart.find((entry) => entry.key === key);
  if (!item) return;
  item.quantity = Math.min(item.availableQty, Math.max(1, toNumber(item.quantity) + delta));
  refreshRegisterUI(key);
}

function setQty(key, quantity) {
  const item = state.cart.find((entry) => entry.key === key);
  if (!item) return;
  item.quantity = Math.min(item.availableQty, Math.max(1, Math.round(quantity || 1)));
  refreshRegisterUI(key);
}

function removeItem(key) {
  const removed = state.cart.find((entry) => entry.key === key);
  state.cart = state.cart.filter((entry) => entry.key !== key);
  if (!state.cart.length) {
    state.discount = 0;
    state.discountType = 'percent';
    state.discountAuthorized = false;
  }
  if (removed) refreshRegisterUI(key);
}

function applyTenderShortcut(shortcut) {
  const totals = getCartTotals();
  if (shortcut === 'exact') {
    state.amountPaid = totals.total;
  } else if (shortcut === 'plus-50') {
    state.amountPaid = totals.total + 50;
  } else if (shortcut === 'plus-100') {
    state.amountPaid = totals.total + 100;
  } else if (shortcut === 'plus-500') {
    state.amountPaid = totals.total + 500;
  }
  renderApp();
}

function applyNumpadKey(key) {
  const totals = getCartTotals();
  if (key === 'ok') {
    state.keypadBuffer = '';
    state.amountPaid = totals.total;
    renderApp();
    return;
  }
  if (key === 'clear') {
    state.keypadBuffer = '';
    state.amountPaid = 0;
    state.keypadBuffer = '';
    renderApp();
    return;
  }
  if (key === 'backspace') {
    state.keypadBuffer = String(state.keypadBuffer || '').slice(0, -1);
    state.amountPaid = toNumber(state.keypadBuffer);
    renderApp();
    return;
  }
  if (key === 'plus') {
    state.amountPaid = toNumber(state.amountPaid) + 50;
    state.keypadBuffer = String(state.amountPaid);
    renderApp();
    return;
  }
  if (key === 'minus') {
    state.amountPaid = Math.max(0, toNumber(state.amountPaid) - 50);
    state.keypadBuffer = String(state.amountPaid);
    renderApp();
    return;
  }
  if (key === '.' && String(state.keypadBuffer || '').includes('.')) return;
  state.keypadBuffer = `${state.keypadBuffer || ''}${key}`;
  state.amountPaid = toNumber(state.keypadBuffer);
  renderApp();
}

function printLastReceipt() {
  const sale = state.lastSale;
  if (!sale) {
    showNotice('warning', 'Aucun reçu', 'Validez une vente avant d’imprimer un reçu.');
    return;
  }
  const lines = Array.isArray(sale.items) ? sale.items : [];
  const printable = window.open('', '_blank', 'width=420,height=720');
  if (!printable) {
    showNotice('warning', 'Impression bloquée', 'Autorisez les fenêtres pop-up pour imprimer le reçu.');
    return;
  }
  const logoUrl = new URL('./assets/smart-caisse-mark.svg', import.meta.url).href;
  printable.document.write(`
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(sale.reference || 'Reçu Smart Cut Services')}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; background: #eef2f7; }
          body {
            width: 80mm;
            color: #111827;
            font: 10px/1.35 Arial, Helvetica, sans-serif;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .receipt {
            width: 80mm;
            margin: 18px auto;
            padding: 5mm 5mm 6mm;
            background: #fff;
            box-shadow: 0 8px 26px rgba(15, 23, 42, .12);
          }
          .receipt-header {
            padding-bottom: 10px;
            text-align: center;
            border-bottom: 1px dashed #9ca3af;
          }
          .receipt-logo {
            display: block;
            width: 27mm;
            height: 27mm;
            margin: 0 auto 7px;
          }
          .receipt-header h1 {
            margin: 0;
            color: #111827;
            font-size: 14px;
            letter-spacing: .04em;
            text-transform: uppercase;
          }
          .receipt-header p {
            margin: 3px 0 0;
            color: #374151;
            font-size: 9px;
          }
          .receipt-header .tagline {
            margin-top: 8px;
            font-size: 9px;
            font-weight: 700;
          }
          .contact {
            margin: 9px 0 0;
            color: #4b5563;
            font-size: 8.5px;
            line-height: 1.5;
            text-align: center;
          }
          .center { text-align: center; }
          .muted { color: #6b7280; }
          .row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 12px;
            margin: 4px 0;
            color: #374151;
          }
          .row strong, .row b { color: #111827; }
          .meta { margin: 10px 0; }
          .meta .row { font-size: 9px; }
          .meta .row strong { max-width: 52mm; text-align: right; word-break: break-word; }
          .line { border-top: 1px dashed #9ca3af; margin: 10px 0; }
          .item {
            margin: 0;
            padding: 8px 0;
            border-bottom: 1px dotted #d1d5db;
          }
          .item:last-of-type { border-bottom: 0; }
          .item strong {
            display: block;
            color: #111827;
            font-size: 10px;
            line-height: 1.25;
          }
          .item .muted {
            display: block;
            margin-top: 2px;
            font-size: 8.5px;
          }
          .item .row { margin-top: 6px; }
          .total {
            margin: 8px 0;
            padding: 9px 0;
            border-top: 1px solid #111827;
            border-bottom: 1px solid #111827;
            color: #111827;
            font-size: 13px;
            font-weight: 800;
          }
          .total strong { color: #111827; font-size: 15px; }
          .footer-note {
            margin: 12px 0 0;
            padding-top: 10px;
            border-top: 1px dashed #9ca3af;
            color: #4b5563;
            font-size: 8.5px;
            line-height: 1.45;
            text-align: center;
          }
          .thanks {
            margin: 10px 0 0;
            color: #111827;
            font-size: 10px;
            font-weight: 700;
            text-align: center;
          }
          @media print {
            html, body { width: 80mm; background: #fff; }
            .receipt { margin: 0; box-shadow: none; }
          }
        </style>
      </head>
      <body>
        <main class="receipt">
          <header class="receipt-header">
            <img class="receipt-logo" src="${escapeHtml(logoUrl)}" alt="Smart Cut Services">
            <h1>Smart Cut Services</h1>
            <p>Delmas, Port-au-Prince, Ouest, Haïti</p>
            <p class="tagline">Smart Cut Services<br>Votre partenaire en matière de personnalisation.</p>
            <p class="contact">Website : www.smartcutservices.com<br>E-mail : administration@smartcutservices.com<br>Phone : +509 3491 3898 / +509 4023 7187</p>
          </header>
          <p class="center muted">Chaque détail compte !</p>
          <div class="meta">
            <div class="row"><span>Référence</span><strong>${escapeHtml(sale.reference || '-')}</strong></div>
            <div class="row"><span>Employé / Propriétaire</span><strong>${escapeHtml(sale.cashierName || getDisplayName())}</strong></div>
            <div class="row"><span>POS</span><strong>SmartCutServices</strong></div>
            <div class="row"><span>Client</span><strong>${escapeHtml(sale.customerName || 'Client comptoir')}</strong></div>
            <div class="row"><span>Date</span><strong>${escapeHtml(formatDate(sale.createdAt))}</strong></div>
          </div>
          <div class="line"></div>
          ${lines.map((item) => `
            <section class="item">
              <strong>${escapeHtml(item.productName)}</strong>
              <span class="muted">${escapeHtml([item.variantLabel, item.sku].filter(Boolean).join(' · '))}</span>
              <div class="row"><span>${escapeHtml(item.quantity)} x ${escapeHtml(formatMoney(item.unitPrice))}</span><b>${escapeHtml(formatMoney(item.lineTotal))}</b></div>
            </section>
          `).join('')}
          <div class="line"></div>
          <div class="row"><span>Sous-total</span><strong>${escapeHtml(formatMoney(sale.subtotal))}</strong></div>
          ${toNumber(sale.discount) > 0 ? `<div class="row"><span>Rabais</span><strong>- ${escapeHtml(formatMoney(sale.discount))}</strong></div>` : ''}
          ${toNumber(sale.tax) > 0 ? `<div class="row"><span>Taxes</span><strong>${escapeHtml(formatMoney(sale.tax))}</strong></div>` : ''}
          <div class="row total"><span>Total</span><strong>${escapeHtml(formatMoney(sale.total))}</strong></div>
          <div class="row"><span>${escapeHtml(formatPaymentMethod(sale.paymentMethod))}</span><strong>${escapeHtml(formatMoney(sale.amountPaid))}</strong></div>
          <div class="row"><span>Monnaie</span><strong>${escapeHtml(formatMoney(sale.changeDue))}</strong></div>
          <p class="footer-note">Merci de vérifier vos produits avant de quitter les lieux, car les retours ne sont normalement pas possibles après l’achat.</p>
          <p class="thanks">Merci pour votre achat.<br>Nous vous remercions pour votre confiance.</p>
        </main>
        <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 250); };</script>
      </body>
    </html>
  `);
  printable.document.close();
}

async function sendStockOperation(payload) {
  const token = await state.user.getIdToken();
  const response = await fetch(STOCK_OPERATION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || 'Stock non mis à jour.');
  }
  return data;
}

async function sendGlobalStockSale(payload) {
  const token = await state.user.getIdToken();
  const response = await fetch('https://us-central1-smartcutservices-9ce54.cloudfunctions.net/smartCaisseSale', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || 'Stock non mis à jour.');
  }
  return data;
}

async function completeSale() {
  state.paymentMethod = 'cash';
  const errorBox = document.getElementById('saleError');
  const submitBtn = document.getElementById('completeSaleBtn');
  const selected = getSelectedLocation();
  const session = getOpenSession();
  const totals = getCartTotals();
  const errors = [];
  if (!state.cart.length) errors.push('Le panier est vide.');
  if (totals.total <= 0) errors.push('Le total doit être supérieur à zéro.');
  if (totals.amountPaid < totals.total) errors.push('Le montant reçu est inférieur au total.');
  state.cart.forEach((item) => {
    if (item.quantity <= 0 || item.quantity > item.availableQty) {
      errors.push(`${item.productName}: quantité invalide.`);
    }
  });
  if (errors.length) {
    errorBox.hidden = false;
    errorBox.innerHTML = errors.map(escapeHtml).join('<br>');
    showNotice('warning', 'Vente à vérifier', errors[0]);
    return;
  }

  const saleId = makeId('cash-sale');
  const reference = `CAISSE-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${saleId.slice(-6).toUpperCase()}`;
  const saleRef = doc(collection(db, CASH_SALE_COLLECTION), saleId);
  const lines = state.cart.map((item) => ({
    productId: item.productId,
    variantId: item.variantId || '',
    locationId: item.locationId,
    quantity: -Math.abs(Math.round(item.quantity)),
    unitCost: toNumber(item.unitCost),
    reason: 'Vente en magasin',
    note: reference,
    oldGlobalStockObserved: item.stockSource === 'product' ? Math.round(toNumber(item.oldGlobalStockObserved || item.availableQty)) : null,
  }));

  submitBtn.disabled = true;
  submitBtn.innerHTML = `${icon('loader-circle')} Validation...`;
  refreshIcons();

  try {
    await setDoc(saleRef, {
      reference,
      status: 'processing',
      source: 'smart-caisse',
      locationId: selected?.id || '',
      locationName: selected?.name || 'Caisse globale',
      sessionId: session?.id || '',
      sessionReference: session?.reference || '',
      customerId: state.selectedClientId || '',
      customerName: normalizeText(state.customerName) || 'Client comptoir',
      customerPhone: normalizeText(state.customerPhone) || '',
      paymentMethod: 'cash',
      discountType: state.discountType,
      discountValue: toNumber(state.discount),
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total,
      amountPaid: totals.amountPaid,
      changeDue: totals.changeDue,
      itemCount: totals.itemCount,
      items: state.cart.map((item) => ({
        productId: item.productId,
        variantId: item.variantId || '',
        productName: item.productName,
        variantLabel: item.variantLabel || '',
        sku: item.sku || '',
        barcode: item.barcode || '',
        quantity: Math.round(item.quantity),
        unitPrice: toNumber(item.unitPrice),
        unitCost: toNumber(item.unitCost),
        lineTotal: toNumber(item.unitPrice) * Math.round(item.quantity),
      })),
      cashierUid: state.user.uid,
      cashierName: getDisplayName(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const operation = selected
      ? await sendStockOperation({
        operationType: 'ADJUSTMENT',
        source: 'smart-caisse',
        idempotencyKey: saleId,
        reference,
        reason: 'Vente en magasin',
        note: `Vente en magasin ${reference}`,
        lines,
      })
      : await sendGlobalStockSale({
        source: 'smart-caisse',
        idempotencyKey: saleId,
        reference,
        reason: 'Vente en magasin',
        note: `Vente en magasin ${reference}`,
        items: state.cart.map((item) => ({
          productId: item.productId,
          variantId: item.variantId || '',
          sourceType: item.sourceType || '',
          vendorId: item.vendorId || '',
          quantity: Math.round(item.quantity),
          unitCost: toNumber(item.unitCost),
        })),
      });
    await setDoc(saleRef, {
      status: 'completed',
      movementIds: operation.movementIds || [],
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    if (session?.id) {
      await updateDoc(doc(db, CASH_SESSION_COLLECTION, session.id), {
        totalSales: increment(totals.total),
        saleCount: increment(1),
        updatedAt: serverTimestamp(),
      }).catch(() => null);
    }
    state.lastSale = {
      reference,
      total: totals.total,
      amountPaid: totals.amountPaid,
      changeDue: totals.changeDue,
      itemCount: totals.itemCount,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      customerName: normalizeText(state.customerName) || 'Client comptoir',
      customerPhone: normalizeText(state.customerPhone) || '',
      paymentMethod: 'cash',
      items: state.cart.map((item) => ({
        productName: item.productName,
        variantLabel: item.variantLabel || '',
        sku: item.sku || '',
        quantity: Math.round(item.quantity),
        unitPrice: toNumber(item.unitPrice),
        lineTotal: toNumber(item.unitPrice) * Math.round(item.quantity),
      })),
      createdAt: new Date().toISOString(),
    };
    state.cart = [];
    state.discount = 0;
    state.discountType = 'percent';
    state.discountAuthorized = false;
    state.amountPaid = 0;
    state.customerName = '';
    state.customerPhone = '';
    state.selectedClientId = '';
    state.clientSearch = '';
    await loadWorkspace();
    showNotice('success', 'Vente validée', `${reference} · ${formatMoney(totals.total)} encaissé.`);
  } catch (error) {
    await setDoc(saleRef, {
      status: 'failed',
      failureMessage: error?.message || 'Validation impossible.',
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => null);
    errorBox.hidden = false;
    errorBox.textContent = error?.message || 'Impossible de terminer la vente.';
    submitBtn.disabled = false;
    submitBtn.innerHTML = `${icon('check-circle-2')} Terminer la vente`;
    showNotice('danger', 'Vente non validée', error?.message || 'Impossible de terminer la vente.');
    refreshIcons();
  }
}

async function closeSession() {
  const session = getOpenSession();
  if (!session) return;
  const counted = toNumber(state.closingAmount);
  await updateDoc(doc(db, CASH_SESSION_COLLECTION, session.id), {
    status: 'closed',
    closingAmount: toNumber(counted),
    closedBy: state.user.uid,
    closedByName: getDisplayName(),
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  state.cart = [];
  state.discount = 0;
  state.discountType = 'percent';
  state.discountAuthorized = false;
  state.amountPaid = 0;
  state.keypadBuffer = '';
  state.closeSessionModal = false;
  state.closingAmount = '';
  await loadWorkspace();
  showNotice('success', 'Caisse fermée', `Montant compté: ${formatMoney(counted)}.`);
}

async function bootstrap() {
  await authReadyPromise.catch(() => null);
  onAuthStateChanged(auth, async (user) => {
    state.user = user && !user.isAnonymous ? user : null;
    state.profile = null;
    state.cart = [];
    if (!state.user) {
      renderLogin();
      return;
    }
    try {
      state.profile = await loadProfile(state.user);
      if (!canUseCaisse(state.profile || {})) {
        renderForbidden();
        return;
      }
      const role = getRole(state.profile || {});
      state.activeView = role === 'manager'
        ? 'manager-overview'
        : role === 'stock_manager'
          ? 'stock-overview'
          : 'register';
      state.managerSearch = '';
      state.stockSearch = '';
      await loadWorkspace();
    } catch (error) {
      root.innerHTML = `
        <section class="app-error">
          <h1>Impossible d’ouvrir la caisse</h1>
          <p>${escapeHtml(error?.message || 'Vérifiez votre connexion et vos permissions.')}</p>
          <button class="secondary-action" onclick="window.location.reload()" type="button">Réessayer</button>
        </section>
      `;
    }
  });
}

setupButtonClickSound();
bootstrap();
