import express from "express";
import cors from "cors";
import { Pool } from "pg";
import dotenv from "dotenv";
import multer from "multer";
import XLSX from "xlsx";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!
});




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

// app.put("/refacciones/:id",upload.single("imagen"), async (req, res) => {
//   const { id } = req.params;
//   const body = req.body || {};
// const { compatibilidad = [], ...campos } = body;

// console.log("BODY:", body);
//     console.log("FILE:", req.file);
//   try {

//     // 📸 si viene imagen, subirla
//       if (req.file) {
//         const uploadImg = await cloudinary.uploader.upload(
//           `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`,
//           { folder: "refacciones" }
//         );

//         campos.imagen = uploadImg.secure_url;
//       }
//     // 🔹 actualizar refacción
//     const keys = Object.keys(campos);
//     const values = Object.values(campos);

//     if (keys.length > 0) {
//         const set = keys.map((k, i) => `${k}=$${i + 1}`).join(",");
//         await pool.query(
//           `UPDATE refacciones SET ${set} WHERE id=$${keys.length + 1}`,
//           [...values, id]
//         );
//       }

    

//     // 🔹 reset compatibilidad
//     await pool.query(
//         "DELETE FROM refaccion_maquina WHERE refaccion_id=$1",
//         [id]
//       );

//     // 🔹 insertar nuevas
//     for (const mid of JSON.parse(compatibilidad || "[]")) {
//         await pool.query(
//           "INSERT INTO refaccion_maquina VALUES ($1,$2)",
//           [id, mid]
//         );
//       }

//     res.json({ ok: true });
//     } catch (e) {
//       console.error(e);
//       res.status(500).json({ ok: false });
//     }
// });
app.put("/refacciones/:id",upload.single("imagen"),async (req, res) => {

    console.log("BODY:", req.body);
    console.log("FILE:", req.file);
    

    
    try {
      const { id } = req.params;
      const body = req.body || {};

      // 🔹 compatibilidad viene como STRING
      let compatibilidad: number[] = [];
      if (body.compatibilidad) {
        compatibilidad = JSON.parse(body.compatibilidad);
      }

      // 🔹 campos normales
      const { compatibilidad: _c, ...campos } = body;
const nummaquina = req.body.nummaquina || null;

if (nummaquina !== null) {
  campos.nummaquina = nummaquina;
}

      let imageUrl = null;
      // 🔹 si hay imagen
      if (req.file) {
  const uploadFromBuffer = () =>
    new Promise<string>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "refacciones" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result!.secure_url);
        }
      );

      streamifier.createReadStream(req.file!.buffer).pipe(stream);
    });

  imageUrl = await uploadFromBuffer();
  campos.imagen = imageUrl;
}

      // 🔹 actualizar refacción
      const keys = Object.keys(campos);
      const values = Object.values(campos);

      if (keys.length > 0) {
        const set = keys.map((k, i) => `${k}=$${i + 1}`).join(",");

        await pool.query(
          `UPDATE refacciones SET ${set} WHERE id=$${keys.length + 1}`,
          [...values, id]
        );
      }

      // 🔹 actualizar compatibilidad
      await pool.query(
        "DELETE FROM refaccion_maquina WHERE refaccion_id=$1",
        [id]
      );

      for (const mid of compatibilidad) {
        await pool.query(
          "INSERT INTO refaccion_maquina (refaccion_id, maquina_id) VALUES ($1,$2)",
          [id, mid]
        );
      }

      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false });
    }
  }
);




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
  const limit = Number(req.query.limit) || 24;
  const offset = (page - 1) * limit;

  const search = req.query.search
    ? `%${req.query.search}%`
    : "%";

  const stock = req.query.stock || "";

  try {
    const data = await pool.query(
      `
      SELECT *
      FROM refacciones
      WHERE (
        nombreprod ILIKE $1
        OR refinterna ILIKE $1
        OR palclave ILIKE $1
      )
      AND (
        $2 = ''
        OR ($2 = 'ok' AND cantidad >= 5)
        OR ($2 = 'low' AND cantidad BETWEEN 1 AND 4)
        OR ($2 = 'zero' AND cantidad = 0)
      )
      ORDER BY id ASC
      LIMIT $3 OFFSET $4
      `,
      [search, stock, limit, offset]
    );

    const total = await pool.query(
      `
      SELECT COUNT(*)
      FROM refacciones
      WHERE (
        nombreprod ILIKE $1
        OR refinterna ILIKE $1
        OR palclave ILIKE $1
      )
      AND (
        $2 = ''
        OR ($2 = 'ok' AND cantidad >= 5)
        OR ($2 = 'low' AND cantidad BETWEEN 1 AND 4)
        OR ($2 = 'zero' AND cantidad = 0)
      )
      `,
      [search, stock]
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

      const errores: any[] = [];
      const refsVistas = new Set<string>();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        const refInterna = row["Referencia interna"]?.toString().trim();
        const cantidad = limpiarCantidad(row["Cantidad a la mano"]);

        // ❌ referencia vacía
        if (!refInterna) {
          errores.push({
            fila: i + 2,
            motivo: "Referencia interna vacía",
            data: row
          });
          continue;
        }

        // ❌ duplicada en el EXCEL
        if (refsVistas.has(refInterna)) {
          errores.push({
            fila: i + 2,
            motivo: "Referencia duplicada en el archivo",
            refInterna
          });
          continue;
        }
        refsVistas.add(refInterna);

        // ❌ cantidad inválida
        if (isNaN(cantidad)) {
          errores.push({
            fila: i + 2,
            motivo: "Cantidad inválida",
            refInterna,
            valor: row["Cantidad a la mano"]
          });
          continue;
        }

        const existe = await pool.query(
          "SELECT id FROM refacciones WHERE refinterna = $1",
          [refInterna]
        );

        if (existe.rows.length > 0) {
          // 🔁 actualiza
          await pool.query(
            "UPDATE refacciones SET cantidad = $1 WHERE refinterna = $2",
            [cantidad, refInterna]
          );
          actualizados++;
        } else {
          // 🆕 inserta
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
        actualizados,
        errores
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false });
    }
  }
);



app.get("/opciones/categorias", (_req, res) => {
  const categorias = [
    "Maquinas",
    "Moldes",
    "Compresores",
    "Red de Agua",
    "Subestacion",
    "Transportes",
    "Equipos Auxiliares",
    "Servicios"
  ];

  res.json(categorias.map(c => ({ valor: c })));
});


app.get("/opciones/maquinamod", (_req, res) => {
  const maquinas = [
    "AOKI",
    "ASB",
    "NISSEI",
    "SUMITOMO",
    "ENLAINADORA",
    "REVOLVEDORA",
    "MOLINO",
    "OTROS"
  ];

  res.json(maquinas.map(m => ({ valor: m })));
});


app.get("/opciones/maquinaesp", (_req, res) => {
  const especificas = [
    "AOKI SBIII-500-150",
    "ASB 150DP",
    "ASB 150 DP STD",
    "ASB 12M",
    "NISSEI FS 160",
    "NISSEI FN3000",
    "NISSEI FNX280",
    "NISSEI FNX220",
    "SUMITOMO SYSTEC 280",
    "SUMITOMO SYSTEC 580",
    "SUMITOMO INTELECT2 S 220",
    "AUTING SMN-03",
    "AUTING LSM-025",
    "XHS-50KGS",
    "PAGANI",
    "RAPID"
  ];

  res.json(especificas.map(e => ({ valor: e })));
});

app.get("/refacciones-filtradas", async (req, res) => {
  const { categoriaprin, maquinamod, maquinaesp } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM refacciones
      WHERE categoriaprin = $1
        AND maquinamod = $2
        AND maquinaesp = $3
      `,
      [categoriaprin, maquinamod, maquinaesp]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false });
  }
});




app.post("/refacciones/:id/compatibles", async (req, res) => {
  const refaccionId = req.params.id;
  const maquinas: number[] = req.body.maquinas || [];

  try {
    await pool.query(
      "DELETE FROM refaccion_maquina WHERE refaccion_id = $1",
      [refaccionId]
    );

    for (const maquinaId of maquinas) {
      await pool.query(
        "INSERT INTO refaccion_maquina (refaccion_id, maquina_id) VALUES ($1, $2)",
        [refaccionId, maquinaId]
      );
    }

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false });
  }
});


// ---
app.get("/refacciones/:id/compatibles", async (req, res) => {
  try {
    const { id } = req.params;

    const r = await pool.query(
      "SELECT maquina_id FROM refaccion_maquina WHERE refaccion_id=$1",
      [id]
    );

    res.json({
      maquinas: r.rows.map(x => x.maquina_id)
    });
  } catch (e) {
    res.status(500).json({ ok:false });
  }
});



// --- Modificación opcional en GET /refacciones/:id para incluir  ---
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

    const refaccion = result.rows[0];

    // Obtenemos  para incluirla directamente
    const comp = await pool.query(
      "SELECT maquina_id FROM refaccion_maquina WHERE refaccion_id = $1",
      [id]
    );
    // refaccion. = comp.rows.map(r => r.maquina_id);

    res.json(refaccion);
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false });
  }
});

app.get("/maquinas", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, maquinamod, maquinaesp
      FROM maquinas
      ORDER BY maquinamod
    `);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ ok:false, error:(e as Error).message });
  }
});

app.get("/opciones/nummaquina", async (req, res) => {
  const r = await pool.query(
    "SELECT valor FROM opciones_nummaquina ORDER BY valor"
  );
  res.json(r.rows);
});

