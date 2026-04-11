import { pool } from "./index";

export const logs: any[] = [];

export async function log(
  level: string,
  message: string,
  req?: any,
  data?: any,
  route?: string
) {

  const usuario_id = req?.usuario?.id || null;
  const rol = req?.usuario?.rol || null;
  const ip = req?.ip || null;

  const entry = {
    level,
    message,
    route,
    usuario_id,
    rol,
    ip,
    data,
    timestamp: new Date()
  };

  // memoria (esto está bien 👍)
  logs.push(entry);
  if (logs.length > 500) logs.shift();

  console.log(
    `[${level}] ${message}`,
    route ? `[${route}]` : "",
    data || ""
  );

  // 🔥 SOLO ERRORES A DB
  if (level !== "ERROR") return;

  try {

    await pool.query(
      `INSERT INTO logs
      (level, message, route, usuario_id, rol, ip, data)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,

      [
        level,
        message,
        route || null,
        usuario_id,
        rol,
        ip,
        data ? JSON.stringify(data) : null
      ]
    );

    // 🔥 LIMPIEZA AUTOMÁTICA
    await pool.query(`
      DELETE FROM logs
      WHERE id NOT IN (
        SELECT id FROM logs
        ORDER BY created_at DESC
        LIMIT 50
      )
    `);

  } catch (error) {
    console.error(`[LOGGER ERROR] ${message}`, error);
  }
}