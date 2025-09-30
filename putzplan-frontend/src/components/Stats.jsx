// src/components/Stats.jsx
import React, { useMemo } from 'react'

/**
 * Wochen-Stats (Balken) + Trendlinie (gleitender Durchschnitt) + Soll-Linie.
 *
 * Props:
 * - doneAssignments: Array<{ task_id:number, done_at:string }>
 * - tasksById: Map<number, TaskLike>  (TaskLike hat mindestens: points:number)
 * - expectedPerWeekPerUser: number    (Soll/Woche)
 * - weeks: number                     (wie viele Wochen zurück, inkl. aktueller)
 * - showTrend: boolean
 * - trendWindow: number               (Fenstergröße für moving average)
 * - scaleMode: 'series' | 'soft' | 'all'
 *      'series' = skaliert nur nach Balken/Trend (empfohlen)
 *      'soft'   = Soll wird nur berücksichtigt, wenn <= softFactor * seriesMax
 *      'all'    = alles bestimmt die Höhe (alte Logik)
 * - softFactor: number                (nur für 'soft')
 */
export default function Stats({
  doneAssignments = [],
  tasksById = new Map(),
  expectedPerWeekPerUser = 0,
  weeks = 8,
  showTrend = true,
  trendWindow = 3,
  scaleMode = 'series',
  softFactor = 1.5,
}) {
  // --- Daten auf Wochen-Buckets aggregieren ---
  const { labels, series, trend } = useMemo(() => {
    const now = new Date()
    const end = endOfWeek(now)
    const starts = []
    for (let i = weeks - 1; i >= 0; i--) {
      starts.push(addDays(end, -7 * i)) // Montags (wenn endOfWeek=Sonntag), spielt für Bucketing keine große Rolle
    }

    // Buckets vorbereiten
    const sums = new Array(weeks).fill(0)

    // Punktzahl pro Assignment anhand Task.points
    for (const a of doneAssignments || []) {
      if (!a?.done_at) continue
      const d = new Date(a.done_at)
      const wIdx = weekIndexForDate(d, starts)
      if (wIdx < 0 || wIdx >= weeks) continue
      const pts = Number(tasksById.get?.(a.task_id)?.points ?? 1)
      sums[wIdx] += pts
    }

    // Labels (KW oder kurzer Datumsbereich)
    const labelsArr = starts.map((st) => {
      const d = new Date(st)
      // z.B. "KW 40" oder "dd.MM."
      return `KW ${isoWeek(d)}`
    })

    // Trend (gleitender Durchschnitt, rückwärts gerichtet, inkl. aktueller Woche)
    const tr = movingAverage(sums, trendWindow)

    return { labels: labelsArr, series: sums, trend: tr }
  }, [doneAssignments, tasksById, weeks, trendWindow])

  // --- Chart-Layout ---
  const H = 220
  const padT = 16, padB = 28, padL = 36, padR = 12
  const barW = 28, gap = 14
  const innerH = H - padT - padB
  const W = padL + weeks * barW + (weeks - 1) * gap + padR

  // --- Y-Skalierung (NEU) ---
  const seriesMax = Math.max(1, ...series)
  const trendMax  = showTrend && trend?.length ? Math.max(...trend) : 0
  let yMax = Math.max(seriesMax, trendMax)

  if (scaleMode === 'all') {
    yMax = Math.max(yMax, expectedPerWeekPerUser || 0)
  } else if (scaleMode === 'soft') {
    if ((expectedPerWeekPerUser || 0) <= seriesMax * softFactor) {
      yMax = Math.max(yMax, expectedPerWeekPerUser || 0)
    }
  }
  // kleiner Puffer, damit nichts am Rand klebt
  yMax = Math.max(1, Math.round(yMax * 1.15))

  const xFor = (i) => padL + i * (barW + gap)
  const yFor = (v) => H - padB - (yMax ? (v / yMax) * innerH : 0)

  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="text-sm text-gray-600 mb-2">Leistung pro Woche</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-56">
        {/* Y-Achse Skala (3 Hilfslinien) */}
        { [0, 0.5, 1].map((t, idx) => {
          const val = Math.round(yMax * t)
          const y = yFor(val)
          return (
            <g key={idx}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="currentColor" opacity="0.08" />
              <text x={padL - 6} y={y} textAnchor="end" dominantBaseline="central" fontSize="10" fill="currentColor" opacity="0.6">{val}</text>
            </g>
          )
        })}

        {/* Soll-Linie (gestrichelt) */}
        {expectedPerWeekPerUser > 0 && (
          <g>
            <line
              x1={padL}
              x2={W - padR}
              y1={yFor(expectedPerWeekPerUser)}
              y2={yFor(expectedPerWeekPerUser)}
              stroke="currentColor"
              strokeDasharray="4 4"
              opacity="0.45"
            />
            <text
              x={W - padR}
              y={yFor(expectedPerWeekPerUser) - 4}
              textAnchor="end"
              fontSize="10"
              fill="currentColor"
              opacity="0.6"
            >
              Soll {Math.round(expectedPerWeekPerUser)}
            </text>
          </g>
        )}

        {/* Balken */}
        {series.map((v, i) => {
          const x = xFor(i)
          const y = yFor(v)
          const h = H - padB - y
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h} rx="4" fill="currentColor" opacity="0.18" />
            </g>
          )
        })}

        {/* Trendlinie (gleitender Durchschnitt) */}
        {showTrend && trend?.length >= 2 && (
          <polyline
            fill="none"
            stroke="currentColor"
            opacity="0.65"
            strokeWidth="2"
            points={trend.map((v, i) => `${xFor(i) + barW / 2},${yFor(v)}`).join(' ')}
          />
        )}

        {/* X-Labels */}
        {labels.map((lb, i) => (
          <text
            key={i}
            x={xFor(i) + barW / 2}
            y={H - 8}
            textAnchor="middle"
            fontSize="10"
            fill="currentColor"
            opacity="0.7"
          >
            {lb}
          </text>
        ))}
      </svg>
    </div>
  )
}

/* ===== Helper-Funktionen ===== */

function startOfWeek(d) {
  const dt = new Date(d)
  const day = dt.getDay() || 7 // So=0 -> 7
  if (day !== 1) dt.setDate(dt.getDate() - (day - 1))
  dt.setHours(0, 0, 0, 0)
  return dt
}
function endOfWeek(d) {
  const s = startOfWeek(d)
  const e = new Date(s)
  e.setDate(s.getDate() + 6)
  e.setHours(23, 59, 59, 999)
  return e
}
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return startOfWeek(x) // immer Wochenstart zurückgeben
}
// in welches Week-Bucket fällt Datum d?
function weekIndexForDate(d, weekStarts) {
  const sd = startOfWeek(d).getTime()
  for (let i = 0; i < weekStarts.length; i++) {
    if (startOfWeek(weekStarts[i]).getTime() === sd) return i
  }
  return -1
}
// ISO-Kalenderwoche quick & dirty
function isoWeek(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  // Donnerstag der Woche
  const dayNum = (tmp.getUTCDay() + 6) % 7
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((tmp.getTime() - firstThursday.getTime()) / 86400000 - 3) / 7)
  return week
}
function movingAverage(arr, windowSize = 3) {
  const n = Math.max(1, windowSize | 0)
  const out = []
  for (let i = 0; i < arr.length; i++) {
    const s = Math.max(0, i - (n - 1))
    const slice = arr.slice(s, i + 1)
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length
    out.push(avg)
  }
  return out
}
