import { NoticeRecord } from '../types';

export function getDaysOfNotice(notice: NoticeRecord): number {
  const noticeDate = new Date(notice.notice_date);
  const windowStart = new Date(notice.window_start);
  return Math.ceil((windowStart.getTime() - noticeDate.getTime()) / (1000 * 60 * 60 * 24));
}

export function getWindowLength(notice: NoticeRecord): number {
  const start = new Date(notice.window_start);
  const end = new Date(notice.window_end);
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}
