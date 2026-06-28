/* ============================================================
   RITUAL — Habit Tracker
   Vanilla JS, ES6 modules-in-one-file (no build step).
   Sections:
     1. Storage layer
     2. State & constants
     3. Utility helpers
     4. Rendering: Dashboard
     5. Rendering: Habits list / CRUD
     6. Rendering: Calendar
     7. Rendering: Stats / charts / badges
     8. Gamification (XP, levels, badges, confetti)
     9. UI chrome (nav, search, theme, modal, toast, shortcuts)
     10. Init
   ============================================================ */

/* ============================================================
   1. STORAGE LAYER
   All persistence goes through this thin wrapper so the rest
   of the app never touches localStorage directly.
   ============================================================ */
const STORAGE_KEYS = {
  habits: 'ritual_habits',
  history: 'ritual_history',       // { 'YYYY-MM-DD': { habitId: true/false } }
  settings: 'ritual_settings',     // { theme, xp, level, lastQuoteDate, quoteIndex }
  badges: 'ritual_badges'          // { badgeId: true }
};

const Storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('Storage read failed for', key, e);
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('Storage write failed for', key, e);
      Toast.show('Could not save — storage may be full.', 'error');
      return false;
    }
  }
};

/* ============================================================
   2. STATE & CONSTANTS
   ============================================================ */
const CATEGORIES = ['Health', 'Study', 'Fitness', 'Work', 'Reading', 'Finance', 'Personal'];

const CATEGORY_ICON = {
  Health: '🩺', Study: '📚', Fitness: '💪', Work: '💼',
  Reading: '📖', Finance: '💰', Personal: '🌱'
};

const EMOJI_CHOICES = ['💧','🏃','🧘','📖','💪','🥗','😴','✍️','🎯','🧠','💰','🌱','🎨','🧹','📵','☀️'];

const COLOR_CHOICES = [
  '#FF6B5E', '#F2B84B', '#7FB069', '#5DA8D6',
  '#B98AE3', '#E36BA0', '#5C6478', '#3FB8AF'
];

const QUOTES = [
  "Small steps, every day, become a mountain moved.",
  "Discipline is choosing what you want most over what you want now.",
  "You don't have to be extreme, just consistent.",
  "Habits are the compound interest of self-improvement.",
  "Progress, not perfection.",
  "The secret of getting ahead is getting started.",
  "Motivation gets you going, habit keeps you going.",
  "Every action is a vote for the person you wish to become.",
  "Success is the sum of small efforts repeated daily.",
  "Today's habits are tomorrow's identity.",
  "Slow is smooth, and smooth is fast.",
  "You are one decision away from a totally different life.",
  "What you do today matters because you're exchanging a day of your life for it.",
  "The chains of habit are too weak to be felt until they are too strong to be broken.",
  "Fall seven times, stand up eight.",
  "A river cuts through rock not because of its power, but its persistence.",
  "Don't count the days, make the days count.",
  "Consistency is what transforms average into excellence.",
  "The pain of discipline is far less than the pain of regret.",
  "Build the habit. The habit builds you."
];

const LEVEL_XP_STEP = 100; // XP needed per level (flat, simple curve)
const XP_PER_COMPLETION = 10;
const XP_STREAK_BONUS_EVERY = 7; // bonus every 7-day streak
const XP_STREAK_BONUS = 25;

// Central in-memory state, hydrated from Storage at init
let state = {
  habits: [],      // { id, name, category, color, icon, frequency, reminder, createdAt }
  history: {},     // { 'YYYY-MM-DD': { [habitId]: true } }
  settings: { theme: 'dark', xp: 0, level: 1, lastQuoteDate: null, quoteIndex: 0 },
  badges: {},
  // transient UI state (not persisted)
  ui: {
    activeView: 'dashboard',
    search: '',
    filterCategory: 'all',
    filterStatus: 'all',
    sortBy: 'default',
    calendarCursor: new Date(), // month being viewed
    editingHabitId: null
  }
};

function loadState() {
  state.habits = Storage.get(STORAGE_KEYS.habits, []);
  state.history = Storage.get(STORAGE_KEYS.history, {});
  state.settings = Object.assign(
    { theme: 'dark', xp: 0, level: 1, lastQuoteDate: null, quoteIndex: 0 },
    Storage.get(STORAGE_KEYS.settings, {})
  );
  state.badges = Storage.get(STORAGE_KEYS.badges, {});
}

function saveHabits() { Storage.set(STORAGE_KEYS.habits, state.habits); }
function saveHistory() { Storage.set(STORAGE_KEYS.history, state.history); }
function saveSettings() { Storage.set(STORAGE_KEYS.settings, state.settings); }
function saveBadges() { Storage.set(STORAGE_KEYS.badges, state.badges); }

/* ============================================================
   3. UTILITY HELPERS
   ============================================================ */
function todayKey(date = new Date()) {
  // local-time YYYY-MM-DD, avoids UTC off-by-one bugs
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function uid() {
  return 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Is a habit "due" for a given date key, based on its frequency?
// daily -> due every day. weekly -> due once, tracked same as daily but
// streak math treats every 7-day block as one unit (simplified: due every day,
// but streak counts consecutive *weeks* completed at least once — kept simple
// here: weekly habits just need 1 completion per week to keep streak).
function isHabitDueOn(habit, dateObj) {
  if (habit.frequency === 'weekly') return true; // can be done any day of the week
  return true; // daily habits are due every day
}

function isHabitCompletedOn(habitId, dateKey) {
  return !!(state.history[dateKey] && state.history[dateKey][habitId]);
}

function setHabitCompletion(habitId, dateKey, value) {
  if (!state.history[dateKey]) state.history[dateKey] = {};
  if (value) {
    state.history[dateKey][habitId] = true;
  } else {
    delete state.history[dateKey][habitId];
    if (Object.keys(state.history[dateKey]).length === 0) delete state.history[dateKey];
  }
  saveHistory();
}

// Current streak for a single habit, counting back from today.
function getHabitStreak(habitId) {
  let streak = 0;
  let cursor = new Date();
  // if not done today, start counting from yesterday (today doesn't break a streak until day ends)
  if (!isHabitCompletedOn(habitId, todayKey(cursor))) {
    cursor = addDays(cursor, -1);
  }
  while (isHabitCompletedOn(habitId, todayKey(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// Longest streak ever for a habit (scans full history).
function getLongestStreakForHabit(habitId) {
  const dates = Object.keys(state.history)
    .filter(k => state.history[k][habitId])
    .sort();
  if (!dates.length) return 0;
  let longest = 1, current = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = parseKey(dates[i - 1]);
    const cur = parseKey(dates[i]);
    const diff = (cur - prev) / 86400000;
    if (diff === 1) {
      current++;
    } else {
      current = 1;
    }
    longest = Math.max(longest, current);
  }
  return longest;
}

// Overall longest streak across all habits (for stats panel).
function getLongestStreakOverall() {
  let max = 0;
  state.habits.forEach(h => { max = Math.max(max, getLongestStreakForHabit(h.id)); });
  return max;
}

// Overall "current streak" shown on dashboard = highest current streak among habits,
// OR a unified "perfect day" streak (every habit done) — we use the more motivating
// of the two: the max individual habit streak, OR a full-completion streak if higher.
function getOverallCurrentStreak() {
  if (state.habits.length === 0) return 0;
  let maxHabitStreak = 0;
  state.habits.forEach(h => { maxHabitStreak = Math.max(maxHabitStreak, getHabitStreak(h.id)); });

  // perfect-day streak: consecutive days where ALL habits were completed
  let perfectStreak = 0;
  let cursor = new Date();
  if (!isDayFullyComplete(todayKey(cursor))) cursor = addDays(cursor, -1);
  while (isDayFullyComplete(todayKey(cursor))) {
    perfectStreak++;
    cursor = addDays(cursor, -1);
  }
  return Math.max(maxHabitStreak, perfectStreak);
}

function isDayFullyComplete(dateKey) {
  if (state.habits.length === 0) return false;
  return state.habits.every(h => isHabitCompletedOn(h.id, dateKey));
}

function getCompletionPctForDate(dateKey) {
  if (state.habits.length === 0) return 0;
  const done = state.habits.filter(h => isHabitCompletedOn(h.id, dateKey)).length;
  return Math.round((done / state.habits.length) * 100);
}

function getTotalCompletedCount() {
  let total = 0;
  Object.values(state.history).forEach(day => { total += Object.keys(day).length; });
  return total;
}

function greetingForHour(hour) {
  if (hour < 5) return 'Still up?';
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

/* ============================================================
   4. RENDERING: DASHBOARD
   ============================================================ */
function renderDashboard() {
  const now = new Date();

  // Date + greeting
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('heroDate').textContent = dateStr;
  document.getElementById('heroGreeting').textContent = greetingForHour(now.getHours());

  // Daily quote (changes once per calendar day, deterministically)
  document.getElementById('heroQuote').textContent = getDailyQuote();

  // Progress ring
  const todayPct = getCompletionPctForDate(todayKey(now));
  const ring = document.getElementById('ringProgress');
  const circumference = 2 * Math.PI * 68; // r=68
  const offset = circumference - (circumference * todayPct) / 100;
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = offset;
  document.getElementById('ringPct').textContent = `${todayPct}%`;

  // Stat cards
  const streak = getOverallCurrentStreak();
  const streakEl = document.getElementById('statStreak');
  streakEl.textContent = streak;
  document.getElementById('flameIcon').classList.toggle('is-lit', streak > 0);

  document.getElementById('statCompleted').textContent = getTotalCompletedCount();

  const lvl = state.settings.level;
  const xpIntoLevel = state.settings.xp % LEVEL_XP_STEP;
  document.getElementById('statLevel').textContent = `Lvl ${lvl}`;
  document.getElementById('statXp').textContent = `${xpIntoLevel} / ${LEVEL_XP_STEP} XP`;

  // Today's ledger list
  renderTodayList();

  // Weekly tally (signature element)
  renderWeekTally();
}

function getDailyQuote() {
  const key = todayKey();
  if (state.settings.lastQuoteDate !== key) {
    state.settings.lastQuoteDate = key;
    state.settings.quoteIndex = Math.floor(Math.random() * QUOTES.length);
    saveSettings();
  }
  return QUOTES[state.settings.quoteIndex] ?? QUOTES[0];
}

function renderTodayList() {
  const list = document.getElementById('todayList');
  const emptyNote = document.getElementById('todayEmpty');
  const key = todayKey();
  list.innerHTML = '';

  if (state.habits.length === 0) {
    emptyNote.hidden = false;
    document.getElementById('todayCount').textContent = '0 of 0';
    return;
  }
  emptyNote.hidden = true;

  const doneCount = state.habits.filter(h => isHabitCompletedOn(h.id, key)).length;
  document.getElementById('todayCount').textContent = `${doneCount} of ${state.habits.length}`;

  state.habits.forEach(habit => {
    list.appendChild(buildHabitItem(habit, key, { showActions: false }));
  });
}

function renderWeekTally() {
  const container = document.getElementById('weekTally');
  container.innerHTML = '';
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const now = new Date();
  const startOfWeek = addDays(now, -now.getDay()); // Sunday

  for (let i = 0; i < 7; i++) {
    const day = addDays(startOfWeek, i);
    const key = todayKey(day);
    const pct = getCompletionPctForDate(key);
    const filledMarks = Math.round((pct / 100) * 5); // 5 marks per row

    const row = document.createElement('div');
    row.className = 'tally__row' + (isSameDay(day, now) ? ' is-today' : '');

    const label = document.createElement('span');
    label.className = 'tally__day';
    label.textContent = dayLabels[i];
    row.appendChild(label);

    const marks = document.createElement('div');
    marks.className = 'tally__marks';
    for (let m = 0; m < 5; m++) {
      const mark = document.createElement('span');
      mark.className = 'tally__mark' + (m < filledMarks ? ' is-filled' : '');
      marks.appendChild(mark);
    }
    row.appendChild(marks);
    container.appendChild(row);
  }
}

/* ============================================================
   5. RENDERING: HABITS LIST / CRUD
   ============================================================ */

// Build a single <li class="habit-item"> for a habit on a given date.
function buildHabitItem(habit, dateKey, opts = {}) {
  const { showActions = true } = opts;
  const done = isHabitCompletedOn(habit.id, dateKey);
  const streak = getHabitStreak(habit.id);

  const li = document.createElement('li');
  li.className = 'habit-item';
  li.style.setProperty('--habit-color', habit.color);
  li.dataset.habitId = habit.id;

  li.innerHTML = `
    <button class="habit-item__check ${done ? 'is-done' : ''}" aria-label="${done ? 'Mark incomplete' : 'Mark complete'}" data-action="toggle">
      <svg viewBox="0 0 24 24" fill="none"><path d="M9 16.2l-3.5-3.5L4 14.2 9 19.2l11-11-1.5-1.4z" fill="currentColor"/></svg>
    </button>
    <div class="habit-item__icon" style="color:${habit.color}">${habit.icon}</div>
    <div class="habit-item__body">
      <p class="habit-item__name ${done ? 'is-done' : ''}">${escapeHtml(habit.name)}</p>
      <div class="habit-item__meta">
        <span>${CATEGORY_ICON[habit.category] || ''} ${habit.category}</span>
        <span>·</span>
        <span>${habit.frequency === 'weekly' ? 'Weekly' : 'Daily'}</span>
        <span class="habit-item__streak">🔥 ${streak}</span>
      </div>
    </div>
    ${showActions ? `
    <div class="habit-item__actions">
      <button data-action="edit" aria-label="Edit habit">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>
      </button>
      <button data-action="delete" aria-label="Delete habit">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 7h12v13a1 1 0 01-1 1H7a1 1 0 01-1-1V7zm3-3h6l1 2h4v2H4V6h4l1-2z" fill="currentColor"/></svg>
      </button>
    </div>` : ''}
  `;

  // Toggle complete/incomplete (only meaningful for "today" contexts)
  li.querySelector('[data-action="toggle"]').addEventListener('click', () => {
    handleToggleHabit(habit.id, dateKey, li);
  });

  if (showActions) {
    li.querySelector('[data-action="edit"]').addEventListener('click', () => openHabitModal(habit.id));
    li.querySelector('[data-action="delete"]').addEventListener('click', () => handleDeleteHabit(habit.id, li));
  }

  return li;
}

function handleToggleHabit(habitId, dateKey, liEl) {
  const wasDone = isHabitCompletedOn(habitId, dateKey);
  setHabitCompletion(habitId, dateKey, !wasDone);

  if (!wasDone) {
    // Completing: award XP, bump animation
    awardXp(XP_PER_COMPLETION);
    const newStreak = getHabitStreak(habitId);
    if (newStreak > 0 && newStreak % XP_STREAK_BONUS_EVERY === 0) {
      awardXp(XP_STREAK_BONUS);
      Toast.show(`🔥 ${newStreak}-day streak! +${XP_STREAK_BONUS} bonus XP`, 'success');
    }
    liEl?.classList.add('bump');
    setTimeout(() => liEl?.classList.remove('bump'), 400);

    checkBadges();

    // Confetti if ALL habits are now complete for today
    if (dateKey === todayKey() && isDayFullyComplete(dateKey)) {
      Confetti.burst();
      Toast.show('All habits complete today — amazing work! 🎉', 'success');
    }
  }

  refreshAllViews();
}

function handleDeleteHabit(habitId, liEl) {
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return;
  if (!confirm(`Delete "${habit.name}"? This can't be undone.`)) return;

  liEl?.classList.add('is-removing');
  setTimeout(() => {
    state.habits = state.habits.filter(h => h.id !== habitId);
    saveHabits();
    // Clean history references (optional — keeps storage tidy)
    Object.keys(state.history).forEach(day => {
      if (state.history[day][habitId]) {
        delete state.history[day][habitId];
        if (Object.keys(state.history[day]).length === 0) delete state.history[day];
      }
    });
    saveHistory();
    refreshAllViews();
    Toast.show(`Deleted "${habit.name}"`, 'success');
  }, 220);
}

function renderHabitsView() {
  const list = document.getElementById('fullHabitList');
  const emptyNote = document.getElementById('fullHabitEmpty');
  list.innerHTML = '';

  let habits = [...state.habits];
  const key = todayKey();

  // Search filter
  if (state.ui.search.trim()) {
    const q = state.ui.search.trim().toLowerCase();
    habits = habits.filter(h => h.name.toLowerCase().includes(q));
  }

  // Category filter
  if (state.ui.filterCategory !== 'all') {
    habits = habits.filter(h => h.category === state.ui.filterCategory);
  }

  // Status filter
  if (state.ui.filterStatus === 'completed') {
    habits = habits.filter(h => isHabitCompletedOn(h.id, key));
  } else if (state.ui.filterStatus === 'pending') {
    habits = habits.filter(h => !isHabitCompletedOn(h.id, key));
  }

  // Sort
  if (state.ui.sortBy === 'alpha') {
    habits.sort((a, b) => a.name.localeCompare(b.name));
  } else if (state.ui.sortBy === 'streak') {
    habits.sort((a, b) => getHabitStreak(b.id) - getHabitStreak(a.id));
  } else {
    habits.sort((a, b) => b.createdAt - a.createdAt);
  }

  if (habits.length === 0) {
    emptyNote.hidden = false;
    return;
  }
  emptyNote.hidden = true;

  habits.forEach(habit => {
    list.appendChild(buildHabitItem(habit, key, { showActions: true }));
  });
}

/* ---------- Habit Modal (Add / Edit) ---------- */
function openHabitModal(habitId = null) {
  closeAllOverlays();
  state.ui.editingHabitId = habitId;
  const overlay = document.getElementById('habitModalOverlay');
  const title = document.getElementById('modalTitle');
  const deleteBtn = document.getElementById('habitDeleteBtn');
  const form = document.getElementById('habitForm');
  form.reset();

  buildEmojiGrid();
  buildColorGrid();

  if (habitId) {
    const habit = state.habits.find(h => h.id === habitId);
    if (!habit) return;
    title.textContent = 'Edit habit';
    deleteBtn.hidden = false;
    document.getElementById('habitId').value = habit.id;
    document.getElementById('habitName').value = habit.name;
    document.getElementById('habitCategory').value = habit.category;
    document.getElementById('habitFrequency').value = habit.frequency;
    document.getElementById('habitReminder').value = habit.reminder || '';
    selectEmoji(habit.icon);
    selectColor(habit.color);
  } else {
    title.textContent = 'New habit';
    deleteBtn.hidden = true;
    document.getElementById('habitId').value = '';
    selectEmoji(EMOJI_CHOICES[0]);
    selectColor(COLOR_CHOICES[0]);
  }

  overlay.hidden = false;
  setTimeout(() => document.getElementById('habitName').focus(), 50);
}

function closeAllOverlays() {
  document.getElementById('habitModalOverlay').hidden = true;
  document.getElementById('shortcutsOverlay').hidden = true;
  document.getElementById('moreMenu').hidden = true;
  document.getElementById('dayDetail').hidden = true;
}

function closeHabitModal() {
  document.getElementById('habitModalOverlay').hidden = true;
  state.ui.editingHabitId = null;
}

function buildEmojiGrid() {
  const grid = document.getElementById('emojiGrid');
  grid.innerHTML = '';
  EMOJI_CHOICES.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-option';
    btn.textContent = emoji;
    btn.dataset.emoji = emoji;
    btn.addEventListener('click', () => selectEmoji(emoji));
    grid.appendChild(btn);
  });
}

function selectEmoji(emoji) {
  document.querySelectorAll('.emoji-option').forEach(el => {
    el.classList.toggle('is-selected', el.dataset.emoji === emoji);
  });
  document.getElementById('emojiGrid').dataset.value = emoji;
}

function buildColorGrid() {
  const grid = document.getElementById('colorGrid');
  grid.innerHTML = '';
  COLOR_CHOICES.forEach(color => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-option';
    btn.style.background = color;
    btn.dataset.color = color;
    btn.setAttribute('aria-label', `Choose color ${color}`);
    btn.addEventListener('click', () => selectColor(color));
    grid.appendChild(btn);
  });
}

function selectColor(color) {
  document.querySelectorAll('.color-option').forEach(el => {
    el.classList.toggle('is-selected', el.dataset.color === color);
  });
  document.getElementById('colorGrid').dataset.value = color;
}

function handleHabitFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('habitId').value;
  const name = document.getElementById('habitName').value.trim();
  if (!name) return;

  const payload = {
    name,
    category: document.getElementById('habitCategory').value,
    frequency: document.getElementById('habitFrequency').value,
    reminder: document.getElementById('habitReminder').value || null,
    icon: document.getElementById('emojiGrid').dataset.value || EMOJI_CHOICES[0],
    color: document.getElementById('colorGrid').dataset.value || COLOR_CHOICES[0]
  };

  if (id) {
    const habit = state.habits.find(h => h.id === id);
    if (habit) Object.assign(habit, payload);
    Toast.show(`Updated "${name}"`, 'success');
  } else {
    state.habits.push({ id: uid(), createdAt: Date.now(), ...payload });
    Toast.show(`Added "${name}" — let's build the habit!`, 'success');
  }

  saveHabits();
  closeHabitModal();
  refreshAllViews();
}

function handleDeleteFromModal() {
  const id = document.getElementById('habitId').value;
  if (!id) return;
  const habit = state.habits.find(h => h.id === id);
  if (!habit) return;
  if (!confirm(`Delete "${habit.name}"? This can't be undone.`)) return;

  state.habits = state.habits.filter(h => h.id !== id);
  saveHabits();
  Object.keys(state.history).forEach(day => {
    if (state.history[day][id]) {
      delete state.history[day][id];
      if (Object.keys(state.history[day]).length === 0) delete state.history[day];
    }
  });
  saveHistory();
  closeHabitModal();
  refreshAllViews();
  Toast.show(`Deleted "${habit.name}"`, 'success');
}


/* ============================================================
   6. RENDERING: CALENDAR
   ============================================================ */
function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  const cursor = state.ui.calendarCursor;
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  document.getElementById('calLabel').textContent = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const weekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  weekdayLabels.forEach(lbl => {
    const el = document.createElement('div');
    el.className = 'cal-weekday';
    el.textContent = lbl;
    grid.appendChild(el);
  });

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  // Leading empty cells
  for (let i = 0; i < startOffset; i++) {
    const el = document.createElement('div');
    el.className = 'cal-cell is-empty';
    grid.appendChild(el);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(year, month, day);
    const key = todayKey(dateObj);
    const pct = getCompletionPctForDate(key);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';
    if (isSameDay(dateObj, today)) cell.classList.add('is-today');
    if (pct === 100) cell.classList.add('is-complete');
    else if (pct > 0) cell.classList.add('is-partial');

    cell.innerHTML = `${day}${pct > 0 ? `<span class="cal-cell__dot" style="background:${pct === 100 ? 'var(--success)' : 'var(--xp)'}"></span>` : ''}`;
    cell.addEventListener('click', () => openDayDetail(key, dateObj));
    grid.appendChild(cell);
  }
}

function openDayDetail(key, dateObj) {
  const panel = document.getElementById('dayDetail');
  const list = document.getElementById('dayDetailList');
  const title = document.getElementById('dayDetailTitle');

  title.textContent = dateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  list.innerHTML = '';

  if (state.habits.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'No habits existed yet.';
    list.appendChild(p);
  } else {
    state.habits.forEach(habit => {
      const done = isHabitCompletedOn(habit.id, key);
      const li = document.createElement('li');
      li.className = 'habit-item';
      li.style.setProperty('--habit-color', habit.color);
      li.innerHTML = `
        <button class="habit-item__check ${done ? 'is-done' : ''}" data-action="toggle" aria-label="Toggle">
          <svg viewBox="0 0 24 24" fill="none"><path d="M9 16.2l-3.5-3.5L4 14.2 9 19.2l11-11-1.5-1.4z" fill="currentColor"/></svg>
        </button>
        <div class="habit-item__icon" style="color:${habit.color}">${habit.icon}</div>
        <div class="habit-item__body">
          <p class="habit-item__name ${done ? 'is-done' : ''}">${escapeHtml(habit.name)}</p>
          <div class="habit-item__meta"><span>${CATEGORY_ICON[habit.category] || ''} ${habit.category}</span></div>
        </div>
      `;
      li.querySelector('[data-action="toggle"]').addEventListener('click', () => {
        const wasDone = isHabitCompletedOn(habit.id, key);
        setHabitCompletion(habit.id, key, !wasDone);
        openDayDetail(key, dateObj); // re-render detail
        renderCalendar();
        refreshAllViews();
      });
      list.appendChild(li);
    });
  }

  panel.hidden = false;
}

/* ============================================================
   7. RENDERING: STATS / CHARTS / BADGES
   ============================================================ */
function renderStats() {
  const today = new Date();

  // Today / week / month percentages
  document.getElementById('statDayPct').textContent = `${getCompletionPctForDate(todayKey(today))}%`;

  const weekDates = [];
  const startOfWeek = addDays(today, -today.getDay());
  for (let i = 0; i < 7; i++) weekDates.push(todayKey(addDays(startOfWeek, i)));
  document.getElementById('statWeekPct').textContent = `${averagePct(weekDates)}%`;

  const monthDates = [];
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) monthDates.push(todayKey(new Date(today.getFullYear(), today.getMonth(), d)));
  document.getElementById('statMonthPct').textContent = `${averagePct(monthDates)}%`;

  document.getElementById('statLongest').textContent = getLongestStreakOverall();

  renderBarChart();
  renderDonutChart();
  renderBadges();
}

function averagePct(dateKeys) {
  if (state.habits.length === 0) return 0;
  const pcts = dateKeys.map(getCompletionPctForDate);
  const sum = pcts.reduce((a, b) => a + b, 0);
  return Math.round(sum / dateKeys.length);
}

function renderBarChart() {
  const container = document.getElementById('barChart');
  container.innerHTML = '';
  const today = new Date();

  for (let i = 13; i >= 0; i--) {
    const day = addDays(today, -i);
    const key = todayKey(day);
    const pct = getCompletionPctForDate(key);

    const wrap = document.createElement('div');
    wrap.className = 'chart__bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'chart__bar';
    bar.style.height = '0%';
    bar.title = `${day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${pct}%`;
    wrap.appendChild(bar);

    const label = document.createElement('span');
    label.className = 'chart__label';
    label.textContent = day.getDate();
    wrap.appendChild(label);

    container.appendChild(wrap);
    // animate height after insertion
    requestAnimationFrame(() => { bar.style.height = `${Math.max(pct, 2)}%`; });
  }
}

function renderDonutChart() {
  const wrap = document.getElementById('donutChart');
  wrap.innerHTML = '';

  const counts = {};
  CATEGORIES.forEach(c => counts[c] = 0);
  state.habits.forEach(h => { counts[h.category] = (counts[h.category] || 0) + 1; });

  const total = state.habits.length;
  const radius = 54, circumference = 2 * Math.PI * radius;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '140');
  svg.setAttribute('height', '140');
  svg.setAttribute('viewBox', '0 0 140 140');

  if (total === 0) {
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('cx', '70'); track.setAttribute('cy', '70'); track.setAttribute('r', radius);
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'var(--ring-track)');
    track.setAttribute('stroke-width', '16');
    svg.appendChild(track);
  } else {
    let offsetAccum = 0;
    CATEGORIES.forEach((cat, i) => {
      const count = counts[cat];
      if (!count) return;
      const frac = count / total;
      const dash = frac * circumference;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '70'); circle.setAttribute('cy', '70'); circle.setAttribute('r', radius);
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', COLOR_CHOICES[i % COLOR_CHOICES.length]);
      circle.setAttribute('stroke-width', '16');
      circle.setAttribute('stroke-dasharray', `${dash} ${circumference - dash}`);
      circle.setAttribute('stroke-dashoffset', `${-offsetAccum}`);
      circle.setAttribute('transform', 'rotate(-90 70 70)');
      svg.appendChild(circle);
      offsetAccum += dash;
    });
  }
  wrap.appendChild(svg);

  const legend = document.createElement('div');
  legend.className = 'donut-legend';
  CATEGORIES.forEach((cat, i) => {
    if (!counts[cat]) return;
    const item = document.createElement('div');
    item.className = 'donut-legend__item';
    item.innerHTML = `<span class="donut-legend__swatch" style="background:${COLOR_CHOICES[i % COLOR_CHOICES.length]}"></span> ${CATEGORY_ICON[cat]} ${cat} · ${counts[cat]}`;
    legend.appendChild(item);
  });
  if (total === 0) {
    legend.innerHTML = '<p class="empty-note">Add habits to see your category mix.</p>';
  }
  wrap.appendChild(legend);
}

/* ============================================================
   8. GAMIFICATION — XP, levels, badges, confetti
   ============================================================ */
const BADGE_DEFS = [
  { id: 'first_habit', name: 'First Step', desc: 'Add your first habit', icon: '🌱', check: () => state.habits.length >= 1 },
  { id: 'five_habits', name: 'Builder', desc: 'Track 5 habits', icon: '🏗️', check: () => state.habits.length >= 5 },
  { id: 'streak_3', name: 'Warming Up', desc: '3-day streak', icon: '🔥', check: () => getOverallCurrentStreak() >= 3 },
  { id: 'streak_7', name: 'One Week Strong', desc: '7-day streak', icon: '🔥', check: () => getOverallCurrentStreak() >= 7 },
  { id: 'streak_30', name: 'Unstoppable', desc: '30-day streak', icon: '🏆', check: () => getOverallCurrentStreak() >= 30 },
  { id: 'perfect_day', name: 'Perfect Day', desc: 'Complete every habit in one day', icon: '✅', check: () => state.habits.length > 0 && isDayFullyComplete(todayKey()) },
  { id: 'completions_50', name: 'Half Century', desc: '50 total completions', icon: '⭐', check: () => getTotalCompletedCount() >= 50 },
  { id: 'completions_200', name: 'Veteran', desc: '200 total completions', icon: '💎', check: () => getTotalCompletedCount() >= 200 },
  { id: 'level_5', name: 'Level 5', desc: 'Reach level 5', icon: '🚀', check: () => state.settings.level >= 5 },
  { id: 'all_categories', name: 'Well Rounded', desc: 'Have a habit in every category', icon: '🧭', check: () => CATEGORIES.every(c => state.habits.some(h => h.category === c)) }
];

function checkBadges() {
  let newlyEarned = [];
  BADGE_DEFS.forEach(def => {
    if (!state.badges[def.id] && def.check()) {
      state.badges[def.id] = true;
      newlyEarned.push(def);
    }
  });
  if (newlyEarned.length) {
    saveBadges();
    newlyEarned.forEach(b => Toast.show(`🏅 Badge earned: ${b.name}`, 'success'));
  }
}

function renderBadges() {
  const grid = document.getElementById('badgeGrid');
  grid.innerHTML = '';
  BADGE_DEFS.forEach(def => {
    const earned = !!state.badges[def.id];
    const card = document.createElement('div');
    card.className = 'badge' + (earned ? ' is-earned' : '');
    card.innerHTML = `
      <span class="badge__icon">${def.icon}</span>
      <span class="badge__name">${def.name}</span>
      <span class="badge__desc">${def.desc}</span>
    `;
    grid.appendChild(card);
  });
}

function awardXp(amount) {
  state.settings.xp += amount;
  const newLevel = Math.floor(state.settings.xp / LEVEL_XP_STEP) + 1;
  if (newLevel > state.settings.level) {
    state.settings.level = newLevel;
    Toast.show(`🎉 Level up! You're now level ${newLevel}`, 'success');
    checkBadges();
  }
  saveSettings();
}

/* ---------- Confetti (lightweight canvas particle burst) ---------- */
const Confetti = {
  canvas: null, ctx: null, particles: [], running: false,

  init() {
    this.canvas = document.getElementById('confettiCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },
  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  },
  burst() {
    const colors = COLOR_CHOICES;
    const count = 120;
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: this.canvas.width / 2,
        y: this.canvas.height / 3,
        vx: (Math.random() - 0.5) * 14,
        vy: Math.random() * -10 - 4,
        size: Math.random() * 6 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 10,
        life: 0
      });
    }
    if (!this.running) { this.running = true; this.tick(); }
  },
  tick() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let alive = false;
    this.particles.forEach(p => {
      p.vy += 0.35; // gravity
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotSpeed;
      p.life++;
      if (p.life < 140) {
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - p.life / 140);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
    });
    if (alive) {
      requestAnimationFrame(() => this.tick());
    } else {
      this.running = false;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
};


/* ============================================================
   9. UI CHROME — nav, search, theme, modal, toast, shortcuts,
      import/export/reset
   ============================================================ */

/* ---------- Toast notifications ---------- */
const Toast = {
  show(message, type = 'default') {
    const stack = document.getElementById('toastStack');
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }
};

/* ---------- View switching ---------- */
function switchView(viewName) {
  state.ui.activeView = viewName;

  document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === viewName));
  document.querySelectorAll('.nav__tab').forEach(t => {
    const active = t.dataset.view === viewName;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', String(active));
  });

  if (viewName === 'dashboard') renderDashboard();
  if (viewName === 'habits') renderHabitsView();
  if (viewName === 'calendar') renderCalendar();
  if (viewName === 'stats') renderStats();
}

function refreshAllViews() {
  // Re-render whichever is visible, plus dashboard stats stay fresh for next visit
  switchView(state.ui.activeView);
}

/* ---------- Theme ---------- */
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  state.settings.theme = theme;
  saveSettings();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#12141C' : '#F7F3EC');

  const iconPath = theme === 'dark'
    ? 'M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z' // moon
    : 'M12 7a5 5 0 100 10 5 5 0 000-10zm0-5h0v2h0V2zm0 18v2-2zm10-8h-2 2zM4 12H2h2zm15.07-7.07l-1.41 1.41 1.41-1.41zM4.93 19.07l1.41-1.41-1.41 1.41zm14.14 0l-1.41-1.41 1.41 1.41zM4.93 4.93l1.41 1.41-1.41-1.41z'; // sun (simplified rays)
  document.getElementById('themeIcon').innerHTML = `<path d="${iconPath}" fill="currentColor"/>`;
}

function toggleTheme() {
  applyTheme(state.settings.theme === 'dark' ? 'light' : 'dark');
}

/* ---------- Search ---------- */
function toggleSearchBar(forceOpen = null) {
  const bar = document.getElementById('searchBar');
  const shouldOpen = forceOpen !== null ? forceOpen : bar.hidden;
  bar.hidden = !shouldOpen;
  if (shouldOpen) {
    document.getElementById('searchInput').focus();
    if (state.ui.activeView !== 'habits') switchView('habits');
  } else {
    document.getElementById('searchInput').value = '';
    state.ui.search = '';
    renderHabitsView();
  }
}

/* ---------- More menu ---------- */
function toggleMoreMenu(forceOpen = null) {
  const menu = document.getElementById('moreMenu');
  const shouldOpen = forceOpen !== null ? forceOpen : menu.hidden;
  menu.hidden = !shouldOpen;
}

/* ---------- Export / Import / Reset ---------- */
function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    habits: state.habits,
    history: state.history,
    settings: state.settings,
    badges: state.badges
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ritual-backup-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  Toast.show('Backup exported.', 'success');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.habits || !data.history) throw new Error('Invalid backup file');

      state.habits = data.habits || [];
      state.history = data.history || {};
      state.settings = Object.assign(state.settings, data.settings || {});
      state.badges = data.badges || {};

      saveHabits(); saveHistory(); saveSettings(); saveBadges();
      applyTheme(state.settings.theme || 'dark');
      refreshAllViews();
      Toast.show('Backup imported successfully.', 'success');
    } catch (err) {
      console.error(err);
      Toast.show('Could not import — invalid file.', 'error');
    }
  };
  reader.readAsText(file);
}

function resetAllData() {
  if (!confirm('Reset ALL data? Habits, history, XP and badges will be permanently deleted.')) return;
  Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
  state.habits = [];
  state.history = {};
  state.settings = { theme: state.settings.theme, xp: 0, level: 1, lastQuoteDate: null, quoteIndex: 0 };
  state.badges = {};
  saveHabits(); saveHistory(); saveSettings(); saveBadges();
  refreshAllViews();
  Toast.show('All data has been reset.', 'success');
}

/* ---------- Keyboard shortcuts ---------- */
function handleKeydown(e) {
  // ignore shortcuts while typing in inputs (except Escape)
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);

  if (e.key === 'Escape') {
    closeHabitModal();
    document.getElementById('shortcutsOverlay').hidden = true;
    toggleMoreMenu(false);
    document.getElementById('dayDetail').hidden = true;
    if (!document.getElementById('searchBar').hidden) toggleSearchBar(false);
    return;
  }

  if (typing) return;

  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openHabitModal(); }
  else if (e.key === '/') { e.preventDefault(); toggleSearchBar(true); }
  else if (e.key === 't' || e.key === 'T') { toggleTheme(); }
  else if (e.key === '1') { switchView('dashboard'); }
  else if (e.key === '2') { switchView('habits'); }
  else if (e.key === '3') { switchView('calendar'); }
  else if (e.key === '4') { switchView('stats'); }
}

/* ============================================================
   10. EVENT WIRING & INIT
   ============================================================ */
function wireEvents() {
  // Nav tabs
  document.querySelectorAll('.nav__tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  // Theme + search + menu icons
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('searchToggle').addEventListener('click', () => toggleSearchBar());
  document.getElementById('searchClose').addEventListener('click', () => toggleSearchBar(false));
  document.getElementById('menuToggle').addEventListener('click', (e) => { e.stopPropagation(); toggleMoreMenu(); });

  document.getElementById('searchInput').addEventListener('input', debounce((e) => {
    state.ui.search = e.target.value;
    renderHabitsView();
  }, 150));

  // Close more-menu when clicking outside
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('moreMenu');
    if (!menu.hidden && !menu.contains(e.target) && e.target.id !== 'menuToggle') {
      toggleMoreMenu(false);
    }
  });

  // More menu actions
  document.getElementById('moreMenu').addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    toggleMoreMenu(false);
    if (action === 'export') exportData();
    if (action === 'import') document.getElementById('importInput').click();
    if (action === 'shortcuts') { closeAllOverlays(); document.getElementById('shortcutsOverlay').hidden = false; }
    if (action === 'reset') resetAllData();
  });

  document.getElementById('importInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });

  document.getElementById('shortcutsClose').addEventListener('click', () => {
    document.getElementById('shortcutsOverlay').hidden = true;
  });

  // FAB
  document.getElementById('fabAdd').addEventListener('click', () => openHabitModal());

  // Habit modal
  document.getElementById('modalClose').addEventListener('click', closeHabitModal);
  document.getElementById('habitModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'habitModalOverlay') closeHabitModal();
  });
  document.getElementById('habitForm').addEventListener('submit', handleHabitFormSubmit);
  document.getElementById('habitDeleteBtn').addEventListener('click', handleDeleteFromModal);

  // Habits view filters
  document.getElementById('filterCategory').addEventListener('change', (e) => {
    state.ui.filterCategory = e.target.value; renderHabitsView();
  });
  document.getElementById('filterStatus').addEventListener('change', (e) => {
    state.ui.filterStatus = e.target.value; renderHabitsView();
  });
  document.getElementById('sortBy').addEventListener('change', (e) => {
    state.ui.sortBy = e.target.value; renderHabitsView();
  });

  // Calendar nav
  document.getElementById('calPrev').addEventListener('click', () => {
    state.ui.calendarCursor = new Date(state.ui.calendarCursor.getFullYear(), state.ui.calendarCursor.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById('calNext').addEventListener('click', () => {
    state.ui.calendarCursor = new Date(state.ui.calendarCursor.getFullYear(), state.ui.calendarCursor.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById('dayDetailClose').addEventListener('click', () => {
    document.getElementById('dayDetail').hidden = true;
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', handleKeydown);

  // Shortcuts modal overlay click-outside-close
  document.getElementById('shortcutsOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'shortcutsOverlay') e.target.hidden = true;
  });
}

function init() {
  loadState();
  applyTheme(state.settings.theme || 'dark');
  Confetti.init();
  wireEvents();
  switchView('dashboard');
  checkBadges();

  // Register service worker for offline support
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(err => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  // Hide loader once everything is painted
  requestAnimationFrame(() => {
    setTimeout(() => document.getElementById('loader').classList.add('is-hidden'), 250);
  });
}

document.addEventListener('DOMContentLoaded', init);
