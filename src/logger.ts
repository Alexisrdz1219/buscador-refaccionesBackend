// type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

// interface LogEntry {
//   time: string;
//   level: LogLevel;
//   route?: string;
//   message: string;
//   data?: any;
// }

// export const logs: LogEntry[] = [];

// export function log(level: LogLevel, message: string, data?: any, route?: string) {

//   const entry: LogEntry = {
//     time: new Date().toISOString(),
//     level,
//     route,
//     message,
//     data
//   };

//   logs.unshift(entry);

//   // límite de memoria
//   if (logs.length > 500) {
//     logs.pop();
//   }

//   console.log(
//   `[${entry.level}] ${entry.message}`,
//   entry.route ? `[${entry.route}]` : "",
//   data || ""
// );
// }

import { pool } from "./index";

export const logs: any[] = [];

export async function log(
  level: string,
  message: string,
  data?: any,
  route?: string
) {

  const entry = {
    level,
    message,
    route,
    data,
    timestamp: new Date()
  };

  logs.push(entry);

  if (logs.length > 500) {
    logs.shift();
  }

  console.log(`[${level}] ${message}`, route || "", data || "");

  // guardar en PostgreSQL
  try {

    await pool.query(
      `INSERT INTO logs(level, message, route, data)
       VALUES($1,$2,$3,$4)`,
      [
        level,
        message,
        route || null,
        data ? JSON.stringify(data) : null
      ]
    );

  } catch (error) {

    console.log(
   `[${entry.level}] ${entry.message}`,
   entry.route ? `[${entry.route}]` : "",
   data || ""
 );

  }
}