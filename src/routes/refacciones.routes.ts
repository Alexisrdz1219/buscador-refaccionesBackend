// import { Router } from "express";


// const router = Router();

// router.put("/refacciones/:id", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { cantidad, ubicacion, observacion } = req.body;

//     await pool.query(
//       `UPDATE refacciones
//        SET cantidad=$1,
//            ubicacion=$2,
//            observacion=$3
//        WHERE id=$4`,
//       [cantidad, ubicacion, observacion, id]
//     );

//     res.json({ ok: true });
//   } catch (error) {
//     res.status(500).json({ ok: false });
//   }
// });
