import express from "express";
import cors from "cors";
import { Pool } from "pg";
import dotenv from "dotenv";
import multer from "multer";
import XLSX from "xlsx";


dotenv.config();

const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get("/test", async (req, res) => {
  const result = await pool.query("SELECT NOW()");
  res.json(result.rows[0]);
});

app.listen(5000, () => {
  console.log("Backend vivo en puerto 5000");
});

app.get("/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      ok: true,
      message: "Backend y base de datos conectados",
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      message: "Error conectando a la base de datos",
    });
  }
});
//  tabla de refacciones
app.get("/refacciones", async (_, res) => {
  const result = await pool.query(
    "SELECT * FROM refacciones ORDER BY id ASC"
  );
  res.json(result.rows);
});

app.post(
  "/importar-excel",
  upload.single("file"),
  async (req, res) => {
    try {
      const workbook = XLSX.read(req.file!.buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);

      let insertados = 0;
      let actualizados = 0;

      for (const row of rows) {

        if (!row.refInterna) continue;

        const existe = await pool.query(
          "SELECT id FROM refacciones WHERE refinterna = $1",
          [row.refInterna]
        );

        if (existe.rows.length > 0) {
          // 🔄 ACTUALIZAR SOLO CANTIDAD
          await pool.query(
            "UPDATE refacciones SET cantidad = $1 WHERE refinterna = $2",
            [Number(row.cantidad) || 0, row.refInterna]
          );
          actualizados++;

        } else {
          // 🆕 INSERTAR NUEVO
          await pool.query(
            `
            INSERT INTO refacciones (
              nombreprod, categoriaprin, maquinamod, maquinaesp,
              tipoprod, modelo, refinterna, palclave,
              cantidad, unidad, ubicacion, observacion, imagen
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
            )
            `,
            [
              row.nombreProd,
              row.categoriaPrin,
              row.maquinaMod,
              row.maquinaEsp,
              row.tipoProd,
              row.modelo,
              row.refInterna,
              row.palClave,
              Number(row.cantidad) || 0,
              row.unidad,
              row.ubicacion,
              row.observacion,
              row.imagen
            ]
          );
          insertados++;
        }
      }

      res.json({
        ok: true,
        insertados,
        actualizados
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false });
    }
  }
);


