import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import type { ScheduleResponse } from '../types';
import { loadMultiDayState, saveMultiDayState } from '../utils/multiDayStorage';

export interface DayResult {
  date: string;
  schedule: ScheduleResponse;
}

interface MultiDayContextValue {
  startDate: string;
  setStartDate: React.Dispatch<React.SetStateAction<string>>;
  numDays: number;
  setNumDays: React.Dispatch<React.SetStateAction<number>>;
  results: DayResult[];
  setResults: React.Dispatch<React.SetStateAction<DayResult[]>>;
  optimalRtcMw: number | null;
  setOptimalRtcMw: React.Dispatch<React.SetStateAction<number | null>>;
  optimalSearchError: string;
  setOptimalSearchError: React.Dispatch<React.SetStateAction<string>>;
  chartView: 'soc' | 'dispatch' | 'compliance';
  setChartView: React.Dispatch<React.SetStateAction<'soc' | 'dispatch' | 'compliance'>>;
}

const MultiDayContext = createContext<MultiDayContextValue | null>(null);

function readInitial() {
  const saved = loadMultiDayState();
  return {
    startDate:          saved?.startDate          ?? '2026-06-01',
    numDays:            saved?.numDays            ?? 7,
    results:            (saved?.results ?? []) as DayResult[],
    optimalRtcMw:       saved?.optimalRtcMw       ?? null,
    optimalSearchError: saved?.optimalSearchError ?? '',
    chartView:          saved?.chartView          ?? ('soc' as const),
  };
}

export function MultiDayProvider({ children }: { children: React.ReactNode }) {
  const [initial] = useState(readInitial);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [numDays, setNumDays] = useState(initial.numDays);
  const [results, setResults] = useState<DayResult[]>(initial.results);
  const [optimalRtcMw, setOptimalRtcMw] = useState<number | null>(initial.optimalRtcMw);
  const [optimalSearchError, setOptimalSearchError] = useState(initial.optimalSearchError);
  const [chartView, setChartView] = useState<'soc' | 'dispatch' | 'compliance'>(initial.chartView);

  const skipPersistRef = useRef(true);
  const persist = useCallback(() => {
    saveMultiDayState({
      startDate,
      numDays,
      chartView,
      results,
      optimalRtcMw,
      optimalSearchError,
    });
  }, [startDate, numDays, chartView, results, optimalRtcMw, optimalSearchError]);

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    persist();
  }, [persist]);

  useEffect(() => {
    const onBeforeUnload = () => persist();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      persist();
    };
  }, [persist]);

  const value: MultiDayContextValue = {
    startDate,
    setStartDate,
    numDays,
    setNumDays,
    results,
    setResults,
    optimalRtcMw,
    setOptimalRtcMw,
    optimalSearchError,
    setOptimalSearchError,
    chartView,
    setChartView,
  };

  return (
    <MultiDayContext.Provider value={value}>
      {children}
    </MultiDayContext.Provider>
  );
}

export function useMultiDay() {
  const ctx = useContext(MultiDayContext);
  if (!ctx) throw new Error('useMultiDay must be used within MultiDayProvider');
  return ctx;
}
