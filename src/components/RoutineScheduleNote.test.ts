import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { RoutineScheduleNote } from "./RoutineScheduleNote";
afterEach(()=>vi.unstubAllGlobals());
it("describes the server where a routine runs without a hosted upsell",()=>{vi.stubGlobal("window",{}); const html=renderToStaticMarkup(createElement(RoutineScheduleNote)); expect(html).toContain('data-routine-schedule-note="server"'); expect(html).not.toContain("<button"); expect(html).not.toContain("<a");});
