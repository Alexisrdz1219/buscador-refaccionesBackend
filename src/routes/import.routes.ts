import { Router } from "express";
import multer from "multer";
import { importOdooExcel } from "../controllers/import.controller";

const router = Router();

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (_req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

router.post("/import/odoo", upload.single("file"), importOdooExcel);

export default router;
