import { describe, expect, it } from 'vitest';

import {
  matchTeacherRoom,
  parseSchedulePayload,
  parseTeacherRoomLinks,
  teacherLookupKey,
} from '@/lib/lecture-sources';

describe('отдельные источники расписания и комнат', () => {
  it('читает видеопару и очную лекцию вместе с местом занятия', () => {
    const data = parseSchedulePayload({
      groups: ['ИСиП-24/1(Р)', 'ПД-24/1'],
      items: [
        {
          date: '19.10.2026', time: '17:25-18:55', group: 'ИСиП-24/1(Р)',
          subject: 'Граф дизайн и мультимедиа (Лек)', teacher: 'Коваленко Д.Р.',
          teachers: ['Коваленко Д.Р.'], format: 'Видео-лекция', pair: 6,
          room: null, room_label: null,
        },
        {
          date: '20.10.2026', time: '08:30-10:00', group: 'ПД-24/1',
          subject: 'История (Лек)', teacher: 'Иванов В.Б.',
          teachers: ['Иванов В.Б.'], format: null, pair: 1,
          room: '301', room_label: 'Аудитория',
        },
      ],
    });

    expect(data.groups).toEqual(['ИСиП-24/1(Р)', 'ПД-24/1']);
    expect(data.items[0]).toMatchObject({
      format: 'Видео-лекция', teachers: ['Коваленко Д.Р.'], room: null, pair: 6,
    });
    expect(data.items[1]).toMatchObject({
      format: null, room: '301', room_label: 'Аудитория', pair: 1,
    });
  });

  it('отвергает страницу ошибки вместо данных расписания', () => {
    expect(() => parseSchedulePayload({ error: 'Service Unavailable' })).toThrow('неожиданном формате');
    expect(() => parseSchedulePayload({ groups: [], items: [] })).toThrow('нет групп или занятий');
  });

  it('сопоставляет преподавателя только по фамилии и двум инициалам', () => {
    const html = `
      <div class="elementor-icon-box-wrapper">
        <h3 class="elementor-icon-box-title">
          <a href="https://eduskp-surgut.store/b/adm-pfh-00g-o3l">Подключиться</a>
        </h3>
        <p class="elementor-icon-box-description">Коваленко <br>Даниил Романович</p>
      </div>
      <div class="elementor-icon-box-wrapper">
        <h3 class="elementor-icon-box-title">
          <a href="https://eduskp-surgut.store/b/vam-sba-jrj-so7">Подключиться</a>
        </h3>
        <p class="elementor-icon-box-description">Иванов Владимир Борисович</p>
      </div>
    `;
    const rooms = parseTeacherRoomLinks(html);

    expect(rooms.size).toBe(2);
    expect(matchTeacherRoom('Коваленко Д.Р.', rooms)).toBe('https://eduskp-surgut.store/b/adm-pfh-00g-o3l');
    expect(matchTeacherRoom('Иванов В.Б.', rooms)).toBe('https://eduskp-surgut.store/b/vam-sba-jrj-so7');
    expect(matchTeacherRoom('Иванов В.А.', rooms)).toBeNull();
    expect(teacherLookupKey('Семёнова Т.А.')).toBe(teacherLookupKey('Семенова Татьяна Андреевна'));
  });

  it('не берёт посторонний адрес и неоднозначные комнаты', () => {
    const html = `
      <div class="elementor-icon-box-wrapper">
        <h3 class="elementor-icon-box-title"><a href="https://evil.example/b/aaa">Подключиться</a></h3>
        <p class="elementor-icon-box-description">Иванов Владимир Борисович</p>
      </div>
      <div class="elementor-icon-box-wrapper">
        <h3 class="elementor-icon-box-title"><a href="https://eduskp-surgut.store/b/room-one">Подключиться</a></h3>
        <p class="elementor-icon-box-description">Коваленко Даниил Романович</p>
      </div>
      <div class="elementor-icon-box-wrapper">
        <h3 class="elementor-icon-box-title"><a href="https://eduskp-surgut.store/b/room-two">Подключиться</a></h3>
        <p class="elementor-icon-box-description">Коваленко Даниил Романович</p>
      </div>
    `;

    const rooms = parseTeacherRoomLinks(html);
    expect(rooms.size).toBe(0);
    expect(matchTeacherRoom('Коваленко Д.Р.', rooms)).toBeNull();
    expect(matchTeacherRoom('Иванов В.Б.', rooms)).toBeNull();
  });
});
