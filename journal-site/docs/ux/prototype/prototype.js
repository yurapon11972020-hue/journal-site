const validScreens = new Set(['groups', 'reports', 'subjects', 'topics', 'login', 'kit']);
const validDevices = new Set(['desktop', 'tablet', 'mobile']);
const params = new URLSearchParams(window.location.search);
const requestedScreen = validScreens.has(params.get('screen')) ? params.get('screen') : 'groups';
const protectedMode = params.get('protected') === '1';

const state = {
  screen: protectedMode && !['kit', 'login'].includes(requestedScreen) ? 'login' : requestedScreen,
  device: validDevices.has(params.get('device')) ? params.get('device') : 'desktop',
  group: 'ИС-31',
  protected: protectedMode,
  authenticated: false,
  pending: protectedMode && !['kit', 'login'].includes(requestedScreen) ? requestedScreen : 'groups',
  wireframe: params.get('wireframe') === '1',
};

if (params.get('capture') === '1') document.body.classList.add('capture');
if (state.wireframe) document.body.classList.add('wireframe');

const screenElements = {
  groups: document.querySelector('#screen-groups'),
  journal: document.querySelector('#screen-journal'),
  login: document.querySelector('#screen-login'),
  kit: document.querySelector('#screen-kit'),
};
const viewElements = {
  reports: document.querySelector('#view-reports'),
  subjects: document.querySelector('#view-subjects'),
  topics: document.querySelector('#view-topics'),
};
const titles = {
  reports: ['Табели', 'Табели студентов', 'Успеваемость и пропуски по каждому студенту'],
  subjects: ['Оценки по предметам', 'Оценки по предметам', 'Оценки, пропуски и темы по датам занятий'],
  topics: ['Темы занятий', 'Темы занятий', 'Материалы и задания из журнала группы'],
};

function closeMenu() {
  document.querySelector('#sidebar').classList.remove('open');
  document.querySelector('#side-backdrop').classList.remove('open');
  document.querySelector('#side-backdrop').hidden = true;
  document.querySelector('#menu-button').setAttribute('aria-expanded', 'false');
}

function openMenu() {
  document.querySelector('#sidebar').classList.add('open');
  document.querySelector('#side-backdrop').hidden = false;
  document.querySelector('#side-backdrop').classList.add('open');
  document.querySelector('#menu-button').setAttribute('aria-expanded', 'true');
}

function render() {
  const isJournal = ['reports', 'subjects', 'topics'].includes(state.screen);
  screenElements.groups.hidden = state.screen !== 'groups';
  screenElements.journal.hidden = !isJournal;
  screenElements.login.hidden = state.screen !== 'login';
  screenElements.kit.hidden = state.screen !== 'kit';

  for (const [name, element] of Object.entries(viewElements)) {
    element.hidden = state.screen !== name;
  }
  if (isJournal) {
    const [crumb, heading, subtitle] = titles[state.screen];
    document.querySelector('#current-breadcrumb').textContent = crumb;
    document.querySelector('#journal-heading').textContent = heading;
    document.querySelector('#journal-subtitle').textContent = subtitle;
  }

  document.querySelectorAll('[data-current-group]').forEach((element) => {
    element.textContent = state.group;
  });
  document.querySelector('#device').dataset.device = state.device;
  document.querySelector('#protected-mode').checked = state.protected;
  document.querySelector('#wireframe-mode').checked = state.wireframe;
  document.querySelectorAll('.studio-screens [data-go]').forEach((button) => {
    button.classList.toggle('active', button.dataset.go === state.screen);
    button.setAttribute('aria-current', button.dataset.go === state.screen ? 'page' : 'false');
  });
  document.querySelectorAll('.studio-device [data-device]').forEach((button) => {
    button.classList.toggle('active', button.dataset.device === state.device);
    button.setAttribute('aria-pressed', String(button.dataset.device === state.device));
  });
  document.querySelectorAll('.side-link[data-go], .mobile-nav [data-go]').forEach((button) => {
    button.classList.toggle('active', button.dataset.go === state.screen);
    button.setAttribute('aria-current', button.dataset.go === state.screen ? 'page' : 'false');
  });
  closeMenu();
}

function navigate(screen) {
  if (!validScreens.has(screen)) return;
  if (state.protected && !state.authenticated && !['kit', 'login'].includes(screen)) {
    state.pending = screen;
    screen = 'login';
  }
  state.screen = screen;
  const next = new URL(window.location.href);
  next.searchParams.set('screen', screen);
  window.history.replaceState(null, '', next);
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 3300);
}

document.addEventListener('click', (event) => {
  const deviceButton = event.target.closest('[data-device]');
  if (deviceButton && deviceButton.closest('.studio-device')) {
    state.device = deviceButton.dataset.device;
    const next = new URL(window.location.href);
    next.searchParams.set('device', state.device);
    window.history.replaceState(null, '', next);
    render();
    return;
  }

  const navButton = event.target.closest('[data-go]');
  if (navButton) {
    if (navButton.dataset.group) state.group = navButton.dataset.group;
    navigate(navButton.dataset.go);
    return;
  }

  const toastButton = event.target.closest('[data-toast]');
  if (toastButton) showToast(toastButton.dataset.toast);

  if (event.target.closest('[data-theme-toggle]')) {
    document.body.classList.toggle('theme-dark');
    showToast(document.body.classList.contains('theme-dark') ? 'Включена тёмная тема' : 'Включена светлая тема');
  }

  const rowButton = event.target.closest('.student-toggle');
  if (rowButton) {
    const expanded = rowButton.getAttribute('aria-expanded') === 'true';
    rowButton.setAttribute('aria-expanded', String(!expanded));
    rowButton.nextElementSibling.hidden = expanded;
  }
});

document.querySelector('#group-search').addEventListener('input', (event) => {
  const query = event.target.value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
  let visible = 0;
  document.querySelectorAll('.group-card').forEach((card) => {
    card.hidden = !card.textContent.toLocaleLowerCase('ru').replaceAll('ё', 'е').includes(query);
    if (!card.hidden) visible += 1;
  });
  document.querySelector('#groups-empty').hidden = visible > 0;
  document.querySelector('#group-grid').hidden = visible === 0;
});
document.querySelector('#reset-groups').addEventListener('click', () => {
  const input = document.querySelector('#group-search');
  input.value = '';
  input.dispatchEvent(new Event('input'));
  input.focus();
});

const studentList = document.querySelector('#student-list');
const studentRows = Array.from(studentList.querySelectorAll('.student-row'));
function updateStudents() {
  const query = document.querySelector('#student-search').value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
  const sort = document.querySelector('#student-sort').value;
  studentRows.sort((a, b) => {
    if (sort === 'average') return Number(b.dataset.average) - Number(a.dataset.average);
    if (sort === 'absences') return Number(b.dataset.absences) - Number(a.dataset.absences);
    return a.dataset.name.localeCompare(b.dataset.name, 'ru');
  });
  let visible = 0;
  studentRows.forEach((row) => {
    studentList.append(row);
    row.hidden = !row.dataset.name.toLocaleLowerCase('ru').replaceAll('ё', 'е').includes(query);
    if (!row.hidden) visible += 1;
  });
  document.querySelector('#students-empty').hidden = visible > 0;
  document.querySelector('#student-count').textContent = `${visible} ${visible === 1 ? 'студент' : visible >= 2 && visible <= 4 ? 'студента' : 'студентов'}`;
}
document.querySelector('#student-search').addEventListener('input', updateStudents);
document.querySelector('#student-sort').addEventListener('change', updateStudents);
document.querySelector('#reset-students').addEventListener('click', () => {
  const input = document.querySelector('#student-search');
  input.value = '';
  updateStudents();
  input.focus();
});

const subjectDetails = {
  design: {
    name: 'Графический дизайн', teacher: 'Д. Р. Коваленко', average: '4,2',
    rows: [
      ['Белов Артём', '5', '5', '4', '5', '4,7', '1 / 0'],
      ['Захарова Мария', '5', '4', '5', '4', '4,4', '1 / 1'],
      ['Ким Денис', '4', 'Н', '4', '3', '3,8', '1 / 2'],
      ['Орлова Анна', '2', 'НУ', '3', '3', '2,8', '2 / 10'],
    ],
    topics: [['11 окт', 'Композиция в веб-интерфейсе', 'Практика: собрать сетку страницы'], ['09 окт', 'Типографика и иерархия текста', 'Подготовить два варианта заголовочного блока']],
  },
  web: {
    name: 'Веб-разработка', teacher: 'А. В. Соколова', average: '3,9',
    rows: [
      ['Белов Артём', '5', '4', '5', '4', '4,5', '0 / 0'],
      ['Захарова Мария', '4', '4', '5', '4', '4,2', '0 / 1'],
      ['Ким Денис', '3', 'Н', '4', '4', '3,6', '1 / 1'],
      ['Орлова Анна', '2', 'НУ', '3', '3', '2,8', '1 / 6'],
    ],
    topics: [['10 окт', 'Адаптивная сетка', 'Сверстать карточки для десктопа и телефона'], ['03 окт', 'Семантическая разметка', 'Подготовить структуру страницы и подписать формы']],
  },
  media: {
    name: 'Мультимедиа', teacher: 'Е. М. Павлова', average: '4,3',
    rows: [
      ['Белов Артём', '5', '5', '5', '4', '4,8', '0 / 0'],
      ['Захарова Мария', '5', '4', '5', '5', '4,7', '0 / 0'],
      ['Ким Денис', '4', '4', '3', '4', '3,7', '0 / 1'],
      ['Орлова Анна', '3', 'НУ', '3', '4', '3,3', '0 / 2'],
    ],
    topics: [['08 окт', 'Экспорт изображений для веба', 'Сравнить размер и качество файлов WebP и PNG'], ['01 окт', 'Подготовка иллюстраций', 'Сохранить изображения для карточек групп']],
  },
};
function renderSubject(key) {
  const subject = subjectDetails[key];
  document.querySelector('#subject-title').textContent = subject.name;
  document.querySelector('#subject-teacher').textContent = `Преподаватель: ${subject.teacher}`;
  document.querySelector('#subject-average').textContent = subject.average;
  const tbody = document.querySelector('.subject-table tbody');
  tbody.replaceChildren();
  for (const row of subject.rows) {
    const tr = document.createElement('tr');
    row.forEach((value, index) => {
      const td = document.createElement('td');
      if (index >= 1 && index <= 4) {
        const badge = document.createElement('span');
        const number = Number(value);
        const tone = Number.isFinite(number)
          ? (number >= 4.5 ? 'good' : number >= 3.8 ? 'info' : number >= 3 ? 'mid' : 'low')
          : value === 'НУ' ? 'valid-absence' : 'absence';
        badge.className = `grade grade-${tone}`;
        badge.textContent = value;
        td.append(badge);
      } else if (index === 5) {
        const strong = document.createElement('strong');
        strong.textContent = value;
        td.append(strong);
      } else td.textContent = value;
      tr.append(td);
    });
    tbody.append(tr);
  }
  const topicsContainer = document.querySelector('.subject-topics');
  topicsContainer.querySelectorAll('.mini-topic').forEach((element) => element.remove());
  subject.topics.forEach(([date, title, task]) => {
    const item = document.createElement('div');
    item.className = 'mini-topic';
    for (const [tag, value] of [['span', date], ['strong', title], ['small', task]]) {
      const node = document.createElement(tag);
      node.textContent = value;
      item.append(node);
    }
    topicsContainer.append(item);
  });
  document.querySelector('#subject-sort').dispatchEvent(new Event('change'));
}
document.querySelector('#subject-select').addEventListener('change', (event) => {
  renderSubject(event.target.value);
  showToast(`Выбран предмет «${subjectDetails[event.target.value].name}»`);
});
document.querySelector('#subject-sort').addEventListener('change', (event) => {
  const tbody = document.querySelector('.subject-table tbody');
  const rows = Array.from(tbody.rows);
  const choice = event.target.value;
  if (choice === 'По фамилии') rows.sort((a, b) => a.cells[0].textContent.localeCompare(b.cells[0].textContent, 'ru'));
  if (choice === 'По среднему баллу') rows.sort((a, b) => Number(b.cells[5].textContent.replace(',', '.')) - Number(a.cells[5].textContent.replace(',', '.')));
  if (choice === 'По пропускам') rows.sort((a, b) => Number(b.cells[6].textContent.split('/')[1]) - Number(a.cells[6].textContent.split('/')[1]));
  if (choice === 'Как в журнале') rows.sort((a, b) => ['Белов Артём','Захарова Мария','Ким Денис','Орлова Анна'].indexOf(a.cells[0].textContent) - ['Белов Артём','Захарова Мария','Ким Денис','Орлова Анна'].indexOf(b.cells[0].textContent));
  rows.forEach((row) => tbody.append(row));
});

document.querySelector('#login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector('#access-code');
  const isValid = input.value.trim() === '1234';
  input.classList.toggle('invalid', !isValid);
  document.querySelector('#login-error').hidden = isValid;
  if (isValid) {
    input.value = '';
    state.authenticated = true;
    navigate(state.pending);
  } else input.focus();
});
document.querySelector('#access-code').addEventListener('input', (event) => {
  if (event.target.value.trim()) {
    event.target.classList.remove('invalid');
    document.querySelector('#login-error').hidden = true;
  }
});

document.querySelector('#protected-mode').addEventListener('change', (event) => {
  state.protected = event.target.checked;
  state.authenticated = false;
  const next = new URL(window.location.href);
  if (state.protected) next.searchParams.set('protected', '1');
  else next.searchParams.delete('protected');
  window.history.replaceState(null, '', next);
  navigate('groups');
});
document.querySelector('#wireframe-mode').addEventListener('change', (event) => {
  state.wireframe = event.target.checked;
  document.body.classList.toggle('wireframe', state.wireframe);
  const next = new URL(window.location.href);
  if (state.wireframe) next.searchParams.set('wireframe', '1');
  else next.searchParams.delete('wireframe');
  window.history.replaceState(null, '', next);
});

document.querySelector('#menu-button').addEventListener('click', () => {
  const menu = document.querySelector('#sidebar');
  if (menu.classList.contains('open')) closeMenu(); else openMenu();
});
document.querySelector('#mobile-more').addEventListener('click', openMenu);
document.querySelector('#side-backdrop').addEventListener('click', closeMenu);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });

renderSubject('design');
render();
