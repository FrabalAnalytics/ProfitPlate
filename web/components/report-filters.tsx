"use client";
import { useId, useState } from "react";
import styles from "./report-layout.module.css";
export function ReportFilters({ section, start, end, cadence, location, locations, wholeBusiness, error }: {
  section: string; start: string; end?: string; cadence?: string; location?: string | null;
  locations: {id:string;name:string}[]; wholeBusiness: boolean; error?: string;
}) {
  const id = useId();
  const [mode, setMode] = useState(cadence ?? (end ? "custom" : "daily"));
  const [validation, setValidation] = useState(error ?? "");
  return <form className={styles.filters} method="get" onSubmit={event => {
    const data = new FormData(event.currentTarget);
    if (mode === "custom") {
      const first = String(data.get("start")), last = String(data.get("end"));
      const message = first > last ? "The end date must be on or after the start date." : (Date.parse(last) - Date.parse(first)) / 86400000 > 366 ? "Choose a report range of at most 367 days." : "";
      if (message) { event.preventDefault(); setValidation(message); return; }
    }
    setValidation("");
  }}>
    <input type="hidden" name="section" value={section} />
    {validation && <p className="notice notice-error filter-error" role="alert">{validation}</p>}
    <div className="field"><label htmlFor={`${id}-cycle`}>Report cycle</label><select id={`${id}-cycle`} name="cadence" value={mode} onChange={e => {setMode(e.target.value);setValidation("");}}><option value="daily">Daily</option><option value="weekly">Weekly (Monday–Sunday)</option><option value="monthly">Monthly</option><option value="custom">Custom range</option></select></div>
    <div className="field"><label htmlFor={`${id}-start`}>Reference / start date</label><input id={`${id}-start`} name="start" type="date" defaultValue={start} required /></div>
    <div className="field"><label htmlFor={`${id}-end`}>End date (custom range)</label><input id={`${id}-end`} name="end" type="date" defaultValue={end ?? start} disabled={mode !== "custom"} required={mode === "custom"} aria-describedby={`${id}-help`} /><p id={`${id}-help`} className="field-help">{mode === "custom" ? "Up to 367 days." : "Dates follow the selected cycle."}</p></div>
    <div className="field"><label htmlFor={`${id}-location`}>Location</label><select id={`${id}-location`} name="location" defaultValue={location ?? ""}>{wholeBusiness && <option value="">Whole business</option>}{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
    <button className="button button-primary">View report</button>
  </form>;
}
