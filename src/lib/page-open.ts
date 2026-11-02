import { useCallback, useEffect, useRef } from "react";


import { openExternalLink } from "./app-links";


export interface PanelPage { botId: string; url: string; nonce: number; at: number }

const PANEL_PAGE_FRESH_MS = 10_000;
let pending: PanelPage | null = null, nonce = 0;
const takers = new Set<() => void>();

export function requestPanelPage(botId: string, url: string, now = Date.now()): void {
  pending = { botId, url, nonce: ++nonce, at: now };
  for (const take of takers) take();
}


export function usePanelPage(botId: string, open: (page: PanelPage) => void): void {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const take = () => {
      const page = pending;
      if (!page || page.botId !== botId) return;
      pending = null;
      if (Date.now() - page.at <= PANEL_PAGE_FRESH_MS) latest.current(page);
    };
    take();
    takers.add(take);
    return () => { takers.delete(take); };
  }, [botId]);
}


export function usePageOpener(): (url: string) => void { return useCallback((url: string) => { void openExternalLink(url).catch(() => {}); }, []); }
