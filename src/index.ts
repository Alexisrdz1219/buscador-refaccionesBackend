import express from "express";
import cors from "cors";
import { Pool } from "pg";
import dotenv from "dotenv";
import multer from "multer";
import XLSX from "xlsx";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";

  // ALmacenamiento en la nube de imágenes
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

  // Conexion con la base de datos
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // VALIDAR CONEXION
  app.get("/test", async (req, res) => {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows[0]);
  });

  app.listen(5000, () => {
    console.log("Backend: 5000");
  });


  app.get("/health", async (_req, res) => {
    try {
      const result = await pool.query("SELECT NOW()");
      res.json({ ok: true, message: "Backend y base de datos conectados", time: result.rows[0].now,});
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, message: "Error conectando a la base de datos",});
    }
  });

  //  Refacciones
  app.get("/refacciones", async (_, res) => {
    const result = await pool.query(
      "SELECT * FROM refacciones ORDER BY id ASC"
    );
    res.json(result.rows);
  });

  const sleep = (ms: number) =>
    new Promise(resolve => setTimeout(resolve, ms));

  // MAPA PARA IMPORTAR DESDE ODOO, CONVIERTE NOMBRES DE COLUMNAS DE ODOO A LOS DE NUESTRA BD
  const mapOdoo: any = {
    "Referencia interna": "refInterna",
    "Cantidad a la mano": "cantidad",
    "Unidad de medida": "unidad",
    "Nombre": "nombreProd",
    "Etiquetas de la plantilla del producto": "palClave"
  };
  // Pagina para saber cuantas refacciones tiene ubicación asignada
  app.get("/refacciones/con-ubicacion", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT *
        FROM refacciones
        WHERE ubicacion IS NOT NULL
        AND TRIM(ubicacion) <> ''
      `);

      return res.json({
        ok: true,
        data: result.rows
      });

    } catch (error) {
      console.error("Error en consulta:", error);
      return res.status(500).json({
        ok: false,
        error: "Error al consultar la base"
      });
    }
  });
  // Importar Excel
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
  // Refacciones por id
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
  // Borrar refacción POR ID
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
  // PREVIEW EXCEL NO FUNCIONA
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
  // LIMPIAR CANTIDAD
  function limpiarCantidad(valor: any): number {
    if (valor === null || valor === undefined) return 0;

    const num = Number(valor);

    if (isNaN(num)) return 0;

    return Math.floor(num); // ⬅️ redondea hacia abajo
  }
  // IMPORTAR DESDE ODOO, ACTUALIZA CANTIDAD Y PALABRAS CLAVE
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

            // 1️⃣ Obtener palabras actuales
    const actual = await pool.query(
    "SELECT palclave FROM refacciones WHERE refinterna = $1",
    [data.refInterna]
  );

    const palActual = actual.rows[0]?.palclave || "";
  const palNuevaRaw = data.palClave || "";

  function procesarPalabras(texto: string) {
    return texto
      .replace(/"/g, "")              // quitar comillas
      .replace(/;/g, ",")             // convertir ; en ,
      .split(",")                     // separar por coma
      .map(p => p.trim().toLowerCase())
      .filter(Boolean);
  }

    const arrActual = procesarPalabras(palActual);
  const arrNueva = procesarPalabras(palNuevaRaw);

    const merged = [...new Set([...arrActual, ...arrNueva])];

  const palFinal = merged.join(", ");

  console.log("Actual:", arrActual);
  console.log("Excel:", arrNueva);
  console.log("Final:", merged);

            await pool.query(
              "UPDATE refacciones SET cantidad = $1, palclave = $2 WHERE refinterna = $3",
              [limpiarCantidad((data.cantidad)) || 0, palFinal, data.refInterna]
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
            console.log("Insertando nueva ref:", data.refInterna);
  console.log("Palabras clave:", data.palClave);

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
  // REFACCIONES PAGINADAS, CON BUSQUEDA Y FILTRO DE STOCK
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
  // OPCIONES PARA FILTRAR MAQUINAS
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
  //  OPCIONES POR MAQUINAMOD 
  app.get("/opciones/maquinamod", (_req, res) => {
    const maquinas = [
      "AOKI",
      "ASB",
      "NISSEI",
      "SUMITOMO",
      "ENLAINADORA",
      "REVOLVEDORA",
      "MOLINO",
      "TOLVAS/SECADOR/ACOND.",
      "DESHUM. CABINA",
      "TERMORREGULADOR",
      "CHILLER"
    ];

    res.json(maquinas.map(m => ({ valor: m })));
  });
  // OPCIONES MAQUINAS ESPECIFICAS
  app.get("/opciones/maquinaesp", (_req, res) => {
    const especificas = [
      // MAQUINAS
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
      "RAPID",
      // TOLVAS, SECADORES
      "MATSUI HD-200",
      "MATSUI HD-300",
      "PIOVAN G35",
      "TOSHIBA ASB01",
      "INCYCLE 24K",
      "SML-150",
      "INCYCLE 75K",
      "PIOVAN T200",
      "PIOVAN TN300",
      "PIOVAN T200/G45",
      "PIOVAN TN300/ESP30",
      // DESHUMIDIFICADORES
      "MATSUI AMD1400",
      "MATSUI AMD1400G",
      "BLUE AIR MSP10",
      "PIOVAN RPA400",
      "PIOVAN RPA1200",
      //TERMOREGULADORES
      "PIOVAN TH0118F",
      "PIOVAN TH0118F(BM)",
      "PIOVAN TH0118F(CC)",
      "PIOVAN TH05",
      // CHILLERS
      "CHILLER PIOVAN MOD. 620",
      "CHILLER EUROKLIMAT EK-602",
      "CHILLER FRIGEL RSD 210",
      "CHILLER FRIGEL RSD 210/24E",
      "CHILLER PRASAD WECO 13L",
      "CHILLER FRIGEL RSD 80",
      "CHILLER FRIGEL RSD 180",
      "CHILLER PIOVAN MOD. 1420",
      "CHILLER FRIGEL RCD300"
    ];

    res.json(especificas.map(e => ({ valor: e })));
  });
  // REFACCIONES FILTRADAS POR CATEGORIA PRINCIPAL, MODELO DE MAQUINA Y MAQUINA ESPECIFICA
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
  // REFACCIONES COMPATIBLES
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
  // refacciones/:id
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
  // LISTA DE MAQUINAS ORDENADAS POR CATEGORIA PRINCIPAL Y MODELO
  app.get("/maquinas", async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT id, categoriaprin, maquinamod, maquinaesp, nombre
        FROM maquinas
        ORDER BY 
          CASE categoriaprin
            WHEN 'ISBM' THEN 1
            WHEN 'INYECTORA' THEN 2
            WHEN 'ENLAINADORA' THEN 3
            WHEN 'REVOLVEDORA' THEN 4
            WHEN 'MOLINO' THEN 5
            WHEN 'TOLVAS/SECADOR/ACOND.' THEN 6
            WHEN 'DESHUMIDIFICADORES' THEN 7
            WHEN 'TERMOREGULADORES' THEN 8
            WHEN 'CHILLERS' THEN 9
            WHEN 'OTROS' THEN 10
            ELSE 99
          END,
          maquinamod
      `);

      res.json(r.rows);

    } catch (e) {
      res.status(500).json({ ok:false, error:(e as Error).message });
    }
  });
  // OPCIONES PARA NUMERO DE MAQUINA
  app.get("/opciones/nummaquina", async (req, res) => {
    const r = await pool.query(
      "SELECT valor FROM opciones_nummaquina ORDER BY valor"
    );
    res.json(r.rows);
  });
  // REFACCIONES POR MAQUINA ID
  app.get("/refacciones-por-maquina/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const { rows } = await pool.query(`
        SELECT r.*
        FROM refacciones r
        JOIN refaccion_maquina rm ON rm.refaccion_id = r.id
        WHERE rm.maquina_id = $1
      `, [id]);
console.log("MAQUINA_ID RECIBIDO:", id);
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json([]);
    }
    
  });
  // REFACCIONES POR MODELO DE MAQUINA
  app.get("/refacciones-por-maquinamod", async (req, res) => {
    try {
      const { maquinamod } = req.query;

      const { rows } = await pool.query(`
        SELECT DISTINCT r.*
        FROM refacciones r
        JOIN refaccion_maquina rm ON rm.refaccion_id = r.id
        JOIN maquinas m ON m.id = rm.maquina_id
        WHERE LOWER(TRIM(m.maquinamod)) = LOWER(TRIM($1))
      `, [maquinamod]);

      console.log("RESULTADOS:", rows.length);

      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json([]);
    }
    
  });
  // REFACCIONES CON FILTROS DE BÚSQUEDA AVANZADA
  app.get("/buscar-refacciones", async (req, res) => {

    const {
      tit,
      ref,
      modelo,
      tipo,
      unidad,
      palabras
    } = req.query;

    let condiciones = [];
    let valores = [];
    let contador = 1;

    if (tit) {

      const result = await pool.query(
        `
        SELECT *
        FROM refacciones
        WHERE nombreprod ILIKE $1
        ORDER BY id DESC
        LIMIT 100
        `,
        [`%${tit}%`]
      );

      return res.json(result.rows);
    }

    if (ref) {
      condiciones.push(`refinterna ILIKE $${contador++}`);
      valores.push(`%${ref}%`);
    }

    if (modelo) {
      condiciones.push(`modelo ILIKE $${contador++}`);
      valores.push(`%${modelo}%`);
    }

    if (tipo) {
      condiciones.push(`tipoprod = $${contador++}`);
      valores.push(tipo);
    }

    if (unidad) {
      condiciones.push(`unidad = $${contador++}`);
      valores.push(unidad);
    }

    if (palabras) {
      condiciones.push(`palclave ILIKE $${contador++}`);
      valores.push(`%${palabras}%`);
    }

    const where = condiciones.length
      ? "WHERE " + condiciones.join(" AND ")
      : "";

    const result = await pool.query(
      `SELECT *
      FROM refacciones
      ${where}
      ORDER BY id DESC
      LIMIT 100`,
      valores
    );

    res.json(result.rows);
  });
  // REFACCIONES METADATA
  app.get("/refacciones-metadata", async (req, res) => {

    const tipos = await pool.query(`
      SELECT DISTINCT tipoprod FROM refacciones WHERE tipoprod IS NOT NULL
    `);

    const unidades = await pool.query(`
      SELECT DISTINCT unidad FROM refacciones WHERE unidad IS NOT NULL
    `);

    res.json({
      tipos: tipos.rows.map(t => t.tipoprod),
      unidades: unidades.rows.map(u => u.unidad)
    });
  });

// INICIO DE SESION
// INICIO DE SESION
// INICIO DE SESION
// INICIO DE SESION
// INICIO DE SESION

  import { Request, Response, NextFunction } from "express";

  async function verificarSesion( req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "Token requerido" });
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET as string
      ) as { id: number; rol: string };

      const sesion = await pool.query(
        `SELECT * FROM sesiones_activas 
        WHERE token = $1 
        AND expira_en > NOW()`,
        [token]
      );

      if (sesion.rows.length === 0) {
        return res.status(403).json({ error: "Sesión inválida o expirada" });
      }

      await pool.query(
        `UPDATE sesiones_activas
        SET ultima_actividad = NOW()
        WHERE token = $1`,
        [token]
      );

      req.usuario = decoded;

      next();
    } catch (err) {
      return res.status(403).json({ error: "Token inválido" });
    }
  }

  const bcrypt = require("bcrypt");
  const jwt = require("jsonwebtoken");

  // FUNCIONALIDAD DE LOGIN
  app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
      const result = await pool.query(
        "SELECT * FROM usuarios WHERE email = $1 AND activo = true",
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Usuario no encontrado" });
      }

      const usuario = result.rows[0];

      const passwordValida = await bcrypt.compare(password, usuario.password);

      if (!passwordValida) {
        return res.status(401).json({ error: "Contraseña incorrecta" });
      }

      const token = jwt.sign(
        { id: usuario.id, rol: usuario.rol },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES }
      );

      await pool.query(
        `INSERT INTO sesiones_activas 
        (usuario_id, token, ip, user_agent, expira_en)
        VALUES ($1, $2, $3, $4, NOW() + INTERVAL '8 hours')`,
        [
          usuario.id,
          token,
          req.ip,
          req.headers["user-agent"]
        ]
      );

      res.json({
        token,
        nombre: usuario.nombre,
        rol: usuario.rol
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error en login" });
    }
  });
  // ROLES
  function permitirRoles(...rolesPermitidos: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.usuario) {
        return res.status(401).json({ error: "No autenticado" });
      }

      if (!rolesPermitidos.includes(req.usuario.rol)) {
        return res.status(403).json({ error: "No tienes permisos" });
      }

      next();
    };
  }
  // PANELADMIN
  app.get(
    "/panel-admin",
    verificarSesion,
    permitirRoles("admin"),
    (req, res) => {
      res.json({ mensaje: "Panel admin" });
    }
  );
  // CERRAR SESION
  app.post("/logout", verificarSesion, async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "Token requerido" });
    }

    const token = authHeader.split(" ")[1];

    await pool.query(
      "DELETE FROM sesiones_activas WHERE token = $1",
      [token]
    );

    res.json({ mensaje: "Sesión cerrada correctamente" });
  });
  // USUARIOS
  app.post("/usuarios", verificarSesion, permitirRoles("admin"), async (req, res) => {
    const { nombre, email, password, rol } = req.body;

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO usuarios (nombre, email, password, rol)
      VALUES ($1, $2, $3, $4)`,
      [nombre, email, hash, rol]
    );

    res.json({ mensaje: "Usuario creado" });
  });
  // SESION ACTIVA
  app.get("/me", verificarSesion, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id, nombre, rol FROM usuarios WHERE id = $1",
        [req.usuario?.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const usuario = result.rows[0];

      res.json({
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al obtener usuario" });
    }
  });
  // SESIONES
  app.get("/sesiones", verificarSesion, permitirRoles("admin"), async (req, res) => {
    const result = await pool.query(`
      SELECT s.id, u.nombre, u.email, s.ip, s.user_agent, s.creada_en, s.expira_en
      FROM sesiones_activas s
      JOIN usuarios u ON u.id = s.usuario_id
      ORDER BY s.creada_en DESC
    `);

    res.json(result.rows);
  });
  // BORRAR SESION POR ID (ADMIN)
  app.delete("/sesiones/:id", verificarSesion, permitirRoles("admin"), async (req, res) => {
    await pool.query(
      "DELETE FROM sesiones_activas WHERE id = $1",
      [req.params.id]
    );

    res.json({ mensaje: "Sesión cerrada por admin" });
  });
  // LIMPIAR SESIONES EXPIRADAS CADA 10 MINUTOS
  setInterval(async () => {
    await pool.query(
      "DELETE FROM sesiones_activas WHERE expira_en < NOW()"
    );
  }, 1000 * 60 * 10); // cada 10 minutos