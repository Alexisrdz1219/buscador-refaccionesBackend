import { Request } from "express";
declare module "express-serve-static-core" {
  interface Request {
    usuario?: {
      id: number;
      rol: string;
      email?: string;
    };
  }
}
