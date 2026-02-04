"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
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
    }
    catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            message: "Error conectando a la base de datos",
        });
    }
});
