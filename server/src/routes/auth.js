import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const [rows] = await db.query(
      "SELECT id, full_name, email, password_hash, role FROM users WHERE email = ? AND active = 1",
      [email]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
      return res.status(401).json({ message: "Email hoặc mật khẩu không đúng." });
    }
    const payload = { id: user.id, name: user.full_name, role: user.role };
    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: "8h" });
    res.json({ token, user: payload });
  } catch (error) { next(error); }
});

router.get("/me", requireAuth, (req, res) => res.json(req.user));
export default router;

