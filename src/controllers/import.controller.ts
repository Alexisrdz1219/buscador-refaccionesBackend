import { Request, Response } from "express";
import XLSX from "xlsx";
import pkg from "pg";
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


export const importOdooExcel = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No se subió ningún archivo" });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json<any>(workbook.Sheets[sheetName]);

    let insertados = 0;
    let actualizados = 0;

    for (const row of data) {
      // 🧹 Normalización
      const nombreProd = row["Nombre"]?.toString().trim();
      const refInterna = row["Referencia interna"]?.toString().trim();
      const cantidad = Number(row["Cantidad a la mano"]) || 0;
      const palClave = row["Etiquetas de la plantilla del producto"]?.toString().trim();
      const unidad = row["Unidad de Medida"]?.toString().trim();

      if (!refInterna) continue;

      // 🔍 Verificar existencia
      const existe = await pool.query(
        "SELECT id FROM refacciones WHERE refInterna = $1",
        [refInterna]
      );

      if (existe.rows.length > 0) {
        // 🔄 UPDATE
        await pool.query(
          `UPDATE refacciones
           SET nombreProd = $1,
               cantidad = $2,
               palClave = $3,
               unidad = $4,
               updated_at = NOW()
           WHERE refInterna = $5`,
          [nombreProd, cantidad, palClave, unidad, refInterna]
        );
        actualizados++;
      } else {
        // ➕ INSERT
        await pool.query(
          `INSERT INTO refacciones
           (nombreProd, refInterna, cantidad, palClave, unidad, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [nombreProd, refInterna, cantidad, palClave, unidad]
        );
        insertados++;
      }
    }

    res.json({
      message: "Importación completada",
      insertados,
      actualizados
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al importar Excel" });
  }
};
