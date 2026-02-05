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

const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));


const mapOdoo: any = {
  "Referencia interna": "refInterna",
  "Cantidad a la mano": "cantidad",
  "Unidad de medida": "unidad",
  "Nombre": "nombreProd",
  "Etiquetas de la plantilla del producto": "palClave"
};


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

app.put("/refacciones/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombreprod,
      categoriaprin,
      maquinamod,
      maquinaesp,
      tipoprod,
      modelo,
      refinterna,
      palclave,
      cantidad,
      unidad,
      ubicacion,
      observacion,
      imagen
    } = req.body;

    await pool.query(
      `
      UPDATE refacciones SET
        nombreprod=$1,
        categoriaprin=$2,
        maquinamod=$3,
        maquinaesp=$4,
        tipoprod=$5,
        modelo=$6,
        refinterna=$7,
        palclave=$8,
        cantidad=$9,
        unidad=$10,
        ubicacion=$11,
        observacion=$12,
        imagen=$13
      WHERE id=$14
      `,
      [
        nombreprod,
        categoriaprin,
        maquinamod,
        maquinaesp,
        tipoprod,
        modelo,
        refinterna,
        palclave,
        cantidad,
        unidad,
        ubicacion,
        observacion,
        imagen,
        id
      ]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false });
  }
});



app.delete("/refacciones/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      "DELETE FROM refacciones WHERE id = $1",
      [id]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false });
  }
});

app.post(
  "/preview-excel",
  upload.single("file"),
  async (req, res) => {
    try {
      const workbook = XLSX.read(req.file!.buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);

      const nuevos: any[] = [];
      const actualizar: any[] = [];

      for (const row of rows) {
        if (!row.refInterna) continue;

        const existe = await pool.query(
          "SELECT id, cantidad FROM refacciones WHERE refinterna = $1",
          [row.refInterna]
        );

        if (existe.rows.length > 0) {
          actualizar.push({
            refInterna: row.refInterna,
            cantidadActual: existe.rows[0].cantidad,
            cantidadNueva: Number(row.cantidad) || 0
          });
        } else {
          nuevos.push(row);
        }
      }

      res.json({
        ok: true,
        nuevos,
        actualizar
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false });
    }
  }
);

function limpiarCantidad(valor: any): number {
  if (valor === null || valor === undefined) return 0;

  const num = Number(valor);

  if (isNaN(num)) return 0;

  return Math.floor(num); // ⬅️ redondea hacia abajo
}

app.post(
  "/importar-excel-odoo",
  upload.single("file"),
  async (req, res) => {
    try {
      const workbook = XLSX.read(req.file!.buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);

      let insertados = 0;
      let actualizados = 0;
      const nuevos: any[] = [];

      for (const row of rows) {

        // Convertimos columnas Odoo → BD
        const data: any = {};

        for (const colOdoo in mapOdoo) {
          const colBD = mapOdoo[colOdoo];
          data[colBD] = row[colOdoo];
        }

        if (!data.refInterna) continue;

        const existe = await pool.query(
          "SELECT id FROM refacciones WHERE refinterna = $1",
          [data.refInterna]
        );

        if (existe.rows.length > 0) {

          await pool.query(
            "UPDATE refacciones SET cantidad = $1 WHERE refinterna = $2",
            [limpiarCantidad((data.cantidad)) || 0, data.refInterna]
          );
          actualizados++;

        } else {

          await pool.query(
            `
            INSERT INTO refacciones
            (nombreprod, refinterna, cantidad, unidad, palclave)
            VALUES ($1,$2,$3,$4,$5)
            `,
            [
              data.nombreProd,
              data.refInterna,
              limpiarCantidad((data.cantidad)) || 0,
              data.unidad,
              data.palClave
            ]
          );

          nuevos.push(data);
          insertados++;
        }
      }

      res.json({
        ok: true,
        insertados,
        actualizados,
        nuevos
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false });
    }
  }
);

app.get("/refacciones-paginadas", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  try {
    const data = await pool.query(
      `
      SELECT * FROM refacciones
      ORDER BY id ASC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    const total = await pool.query(
      "SELECT COUNT(*) FROM refacciones"
    );

    res.json({
      rows: data.rows,
      total: Number(total.rows[0].count),
      page,
      limit
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

app.get("/refacciones/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT * FROM refacciones WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false });
  }
});

app.post(
  "/importar-odoo",
  upload.single("file"),
  async (req, res) => {
    try {
      const workbook = XLSX.read(req.file!.buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);

      let insertados = 0;
      let actualizados = 0;

      for (const row of rows) {

        const refInterna = row["Referencia interna"];
        const cantidad = Number(row["Cantidad a la mano"]);

        if (!refInterna || isNaN(cantidad)) continue;

        const existe = await pool.query(
          "SELECT id FROM refacciones WHERE refinterna = $1",
          [refInterna]
        );

        if (existe.rows.length > 0) {
          // 🔁 SOLO ACTUALIZA CANTIDAD
          await pool.query(
            "UPDATE refacciones SET cantidad = $1 WHERE refinterna = $2",
            [cantidad, refInterna]
          );
          actualizados++;
        } else {
          // 🆕 CREA SI NO EXISTE
          await pool.query(
            `
            INSERT INTO refacciones (
              nombreprod,
              refinterna,
              cantidad,
              unidad,
              palclave
            ) VALUES ($1, $2, $3, $4, $5)
            `,
            [
              row["Nombre"] || "SIN NOMBRE",
              refInterna,
              cantidad,
              row["Unidad de medida"] || "",
              row["Etiquetas de la plantilla del producto"] || ""
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
