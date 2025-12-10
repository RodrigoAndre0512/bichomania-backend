const express = require('express');
const PDFDocument = require("pdfkit");
const cors = require('cors');
const mysql = require('mysql2');
const fs = require("fs");
const bcrypt = require('bcrypt');
const excel = require('exceljs');
const multer = require('multer');
const path = require("path");
require('dotenv').config(); 
const app = express();
const PORT = process.env.PORT || 3001;

//bcrypt.hash("mathias123", 10).then(h => console.log(h));
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: { rejectUnauthorized: false } 
});

app.get('/', (req, res) => {
    res.send('Servidor funcionando.');
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
app.get("/test-db", (req, res) => {
    db.query("SELECT 1 + 1 AS resultado", (err, rows) => {
        if (err) return res.status(500).json({ error: err });
        res.json(rows);
    });
})
app.post("/registrar", async (req, res) => {
  const {
    nombre,
    apellido_paterno,
    telefono,
    correo_electronico,
    dni,
    contrasena
  } = req.body;

  console.log("Datos recibidos en backend:", req.body); // 👀 debug

  try {
    const hash = await bcrypt.hash(contrasena, 10);

    const sql = `
      INSERT INTO clientes 
      (nombre, apellido_paterno, telefono, correo_electronico, dni, contrasena)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
      nombre,
      apellido_paterno,
      telefono,
      correo_electronico,
      dni,
      hash
    ], (err, result) => {
      if (err) {
        console.error("Error SQL:", err);
        return res.status(500).json({ message: "Error SQL", error: err });
      }

      console.log("Usuario insertado con ID:", result.insertId);
      res.json({ message: "Usuario registrado exitosamente" });
    });
  } catch (error) {
    console.error("Error interno:", error);
    return res.status(500).json({ message: "Error interno", error });
  }
});

app.get("/profile", (req, res) => {
    const { id_cliente } = req.query;

    const datos_perfil = `
        SELECT nombre, apellido_paterno, apellido_materno, telefono, correo_electronico, dni, saldo
        FROM clientes
        WHERE id_cliente = ?
    `;

    db.query(datos_perfil, [id_cliente], (err, results) => {
        if (err) {
            console.log("ERROR SQL:", err);
            return res.status(500).send("Error al buscar obtener usuario");
        }

        
        res.send(results[0]);
    });
});

app.post('/login/user', (req, res) => {
    const { correo, password } = req.body;

    const query = 'SELECT * FROM clientes WHERE correo_electronico = ?';

    db.query(query, [correo], async (err, results) => {
        if (err) {
            console.error("Error SQL:", err);
            return res.status(500).send("Error en la BD");
        }
        if (results.length === 0) return res.status(404).send("Usuario no encontrado");

        const usuario = results[0];


        try {
            const passwordValida = await bcrypt.compare(password, usuario.contrasena);

            if (!passwordValida) {
                return res.status(401).send("Contraseña incorrecta");
            }

            res.json({
                message: "Login exitoso",
                usuario: {
                    id: usuario.id_cliente,          
                    nombre: usuario.nombre,
                    correo: usuario.correo_electronico,
                    rol: "cliente"
                }
            });
        } catch (error) {
            console.error("Error en bcrypt.compare:", error);
            return res.status(500).send("Error interno en validación");
        }
    });
});

app.post('/login/employee', (req, res) => {
    const { correo, password } = req.body;

    const query = 'SELECT * FROM empleados WHERE correo_electronico = ?';

    db.query(query, [correo], async (err, results) => {
        if (err) return res.status(500).send("Error en la BD");
        if (results.length === 0) return res.status(404).send("Empleado no encontrado");

        const empleado = results[0];
        const passwordValida = await bcrypt.compare(password, empleado.contrasena);

        if (!passwordValida) return res.status(401).send("Contraseña incorrecta");

        res.send({
            message: "Login de empleado exitoso",
            empleado: {
                id: empleado.id_empleado,
                nombre: empleado.nombre,
                correo: empleado.correo_electronico,
                cargo: empleado.cargo,
                rol: "empleado"
            }
        });
    });
});

app.post('/productos/agregar', upload.single('imagen'), async (req, res) => {
    const dbp = db.promise(); 

    const { nombre, caracteristica, precio, id_categoria, id_competencia, id_marca, id_equipo } = req.body;
    const imagen = req.file ? `/uploads/${req.file.filename}` : "/uploads/default.png";

    try {
        const [insertProducto] = await dbp.query(`
            INSERT INTO productos(nombre, caracteristica, precio, id_categoria, id_competencia, imagen)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [nombre, caracteristica, precio, id_categoria, id_competencia, imagen]);

        const id_producto = insertProducto.insertId;

        if (id_marca && id_marca !== "") {
            await dbp.query(`
                INSERT INTO marcas_productos(id_marca, id_producto)
                VALUES (?, ?)
            `, [id_marca, id_producto]);
        }

        if (id_equipo && id_equipo !== "") {
            await dbp.query(`
                INSERT INTO equipos_productos(id_equipo, id_producto)
                VALUES (?, ?)
            `, [id_equipo, id_producto]);
        }

        res.json({ message: 'Producto agregado correctamente', id_producto });

    if (!req.file) {
        return res.status(400).json({
            error: "NO llegó la imagen al backend. Multer no recibió nada."
        });
    }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al insertar el producto' });
    }
});

app.delete("/productos/eliminar/:id", async (req, res) => {
    const { id } = req.params;
    const dbp = db.promise(); 
    try {
       
        const [rows] = await dbp.query(
            "SELECT imagen FROM productos WHERE id_producto = ?",
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: "Producto no encontrado" });
        }

        const imagen = rows[0].imagen;

        await dbp.query("DELETE FROM equipos_productos WHERE id_producto = ?", [id]);
        await dbp.query("DELETE FROM marcas_productos WHERE id_producto = ?", [id]);
        await dbp.query("DELETE FROM productos WHERE id_producto = ?", [id]);
        if (imagen) {
            const fs = require("fs");

            const ruta = `.${imagen}`; 

            fs.unlink(ruta, (err) => {
                if (err) console.log("⚠ No se pudo borrar imagen:", ruta);
            });
        }

        res.json({ message: "Producto eliminado correctamente" });

    } catch (err) {
        console.error("ERROR AL ELIMINAR PRODUCTO:", err);
        res.status(500).json({ error: "Error al eliminar producto" });
    }
});

app.get('/productos', (req, res) => {
    const { categoria, marca, equipo, competencia, nombre } = req.query;

    let query = `
        SELECT DISTINCT 
            p.id_producto,
            p.nombre AS nombre_producto, 
            p.precio,
            p.caracteristica,
            p.imagen,
            c.nombre AS categoria,
            cmp.nombre AS competencia,
            m.nombre AS marca,
            e.nombre AS equipo
        FROM productos p
        LEFT JOIN categoria c ON p.id_categoria = c.id_categoria
        LEFT JOIN competencias cmp ON p.id_competencia = cmp.id_competencia
        LEFT JOIN marcas_productos mp ON p.id_producto = mp.id_producto
        LEFT JOIN marcas m ON mp.id_marca = m.id_marca
        LEFT JOIN equipos_productos ep ON p.id_producto = ep.id_producto
        LEFT JOIN equipos e ON ep.id_equipo = e.id_equipo
        WHERE 1 = 1
    `;

    let params = [];

    if (categoria) {
        query += " AND p.id_categoria = ?";
        params.push(categoria);
    }

    if (competencia) {
        query += " AND p.id_competencia = ?";
        params.push(competencia);
    }

    if (marca) {
        query += " AND mp.id_marca = ?";
        params.push(marca);
    }

    if (equipo) {
        query += " AND ep.id_equipo = ?";
        params.push(equipo);
    }

    if (nombre) {
        query += " AND p.nombre LIKE ?";
        params.push(`%${nombre}%`);
    }

    db.query(query, params, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Error al filtrar productos");
        }
        res.json(results);
    });
});

app.get('/producto/:id', (req, res) => {
    const { id } = req.params;

    const query = `
        SELECT 
            p.id_producto,
            p.nombre AS nombre_producto,
            p.precio,
            p.caracteristica,
            p.imagen,
            c.nombre AS categoria,
            cmp.nombre AS competencia,
            m.nombre AS marca,
            e.nombre AS equipo
        FROM productos p
        LEFT JOIN categoria c ON p.id_categoria = c.id_categoria
        LEFT JOIN competencias cmp ON p.id_competencia = cmp.id_competencia
        LEFT JOIN marcas_productos mp ON p.id_producto = mp.id_producto
        LEFT JOIN marcas m ON mp.id_marca = m.id_marca
        LEFT JOIN equipos_productos ep ON p.id_producto = ep.id_producto
        LEFT JOIN equipos e ON ep.id_equipo = e.id_equipo
        WHERE p.id_producto = ?
        LIMIT 1;
    `;

    db.query(query, [id], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Error al obtener producto");
        }
        res.json(results[0]);
    });
});

app.get('/categorias', (req, res) => {
    db.query("SELECT * FROM categoria", (err, results) => {
        if (err) return res.status(500).send("Error al obtener categorías");
        res.json(results);
    });
});

app.get('/marcas', (req, res) => {
    db.query("SELECT * FROM marcas", (err, results) => {
        if (err) return res.status(500).send("Error al obtener marcas");
        res.json(results);
    });
});

app.get('/equipos', (req, res) => {
    db.query("SELECT * FROM equipos", (err, results) => {
        if (err) return res.status(500).send("Error al obtener equipos");
        res.json(results);
    });
});

app.get('/competencias', (req, res) => {
    db.query("SELECT * FROM competencias", (err, results) => {
        if (err) return res.status(500).send("Error al obtener competencias");
        res.json(results);
    });
});

app.get('/listas', (req, res) => {
    const queries = {
        categorias: "SELECT * FROM categoria",
        competencias: "SELECT * FROM competencias",
        equipos: "SELECT * FROM equipos",
        marcas: "SELECT * FROM marcas"
    };

    const results = {};

    let completed = 0;
    const total = Object.keys(queries).length;

    for (const key in queries) {
        db.query(queries[key], (err, rows) => {
            if (err) return res.status(500).send("Error al obtener listas");

            results[key] = rows;
            completed++;

            if (completed === total) {
                res.json(results);
            }
        });
    }
});


app.post("/crear_encuesta", (req, res) => {
  const { fecha_inicio, fecha_fin, descripcion, opciones, id_empleado } = req.body;

  if (!fecha_inicio || !fecha_fin || !descripcion || !opciones || opciones.length === 0 || !id_empleado) {
    return res.status(400).send("Faltan datos de la encuesta");
  }

  const insertarEncuesta = `
    INSERT INTO encuestas (fecha_inicio, fecha_fin, descripcion, id_empleado, id_estado)
    VALUES (?, ?, ?, ?, 1)
  `;

  db.query(insertarEncuesta, [fecha_inicio, fecha_fin, descripcion, id_empleado], (err, result) => {
    if (err) {
      console.error("ERROR INSERT ENCUESTA:", err);
      return res.status(500).send("Error al crear encuesta");
    }

    const id_encuesta = result.insertId;

    const valoresDetalles = opciones.map(op => [
      id_encuesta,
      op.opcion_equipo,
      op.opcion_liga,
      op.categoria
    ]);

    const insertarDetalles = `
      INSERT INTO detalles_encuestas (id_encuesta, opcion_equipo, opcion_liga, categoria)
      VALUES ?
    `;

    db.query(insertarDetalles, [valoresDetalles], (err2) => {
      if (err2) {
        console.error("ERROR INSERT DETALLES:", err2);
        return res.status(500).send("Error al insertar opciones");
      }

      res.status(200).send("Encuesta creada correctamente");
    });
  });
});

app.delete("/eliminar_encuesta/:id", (req, res) => {
  const { id } = req.params;

  const sql = "DELETE FROM encuestas WHERE id_encuesta = ?";
  db.query(sql, [id], (err, result) => {
    if (err) return res.status(500).send("Error al eliminar encuesta");
    res.send("Encuesta eliminada");
  });
});

app.put("/cerrar_encuesta/:id", (req, res) => {
    const { id } = req.params;

    const query = `
        UPDATE encuestas
        SET id_estado = 2
        WHERE id_encuesta = ?
    `;

    db.query(query, [id], (err, result) => {
        if (err) return res.status(500).send("Error al cerrar encuesta");
        res.send("Encuesta cerrada");
    });
});
app.get("/clientes", (req, res) => {
    const query = `SELECT id_cliente, nombre, apellido_paterno, apellido_materno, telefono, correo_electronico, dni, saldo 
                   FROM clientes`;

    db.query(query, (err, results) => {
        if (err) return res.status(500).send("Error al obtener clientes");
        res.send(results);
    });
});
app.get("/encuestas-activas", (req, res) => {
    const query = `
        SELECT id_encuesta, fecha_inicio, fecha_fin, descripcion
        FROM encuestas
        WHERE id_estado = 1
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).send("Error al obtener encuestas activas");
        res.send(results);
    });
});
app.get("/encuestas", (req, res) => {
    const { id_empleado } = req.query;

    if (!id_empleado) {
        return res.status(400).send("Falta el id_empleado");
    }

    const ver_encuestas = `
        SELECT 
            e.id_encuesta,
            e.fecha_inicio,
            e.fecha_fin,
            e.descripcion,
            s.nombre AS estado
        FROM encuestas e
        JOIN estados s ON e.id_estado = s.id_estado
        WHERE e.id_empleado = ?
    `;

    db.query(ver_encuestas, [id_empleado], (err, results) => {
        if (err) return res.status(500).send("Error al buscar encuestas");
        res.send(results);
    });
});
app.get("/carrito", (req, res) => {              
    const id_cliente = req.query.id_cliente;

    if (!id_cliente) {
        return res.status(400).send("Usuario no encontrado");
    }

    const buscarCarrito = `
        SELECT id_carrito FROM carritos
        WHERE id_cliente = ? AND id_estado = 6
        LIMIT 1
    `;

    db.query(buscarCarrito, [id_cliente], (err, results) => {
        if (err) return res.status(500).send("Error al buscar carrito");

        if (results.length === 0) {
            return res.send({ mensaje: "No hay carrito creado" });
        }

        const id_carrito = results[0].id_carrito;

        const consultaProductos = `
            SELECT i.id_producto, i.cantidad, p.nombre, p.precio
            FROM items_carrito i
            JOIN productos p ON (i.id_producto = p.id_producto)
            WHERE i.id_carrito = ?
        `;

        db.query(consultaProductos, [id_carrito], (err, productos) => {
            if (err) return res.status(500).send("Error al recuperar productos");
            res.send({id_carrito,productos});
        });
    });
});
app.post("/carrito/agregar", (req, res) => {
    const { id_cliente, id_producto, cantidad } = req.body;

    if (!id_cliente || !id_producto || !cantidad) {
        return res.status(400).send("Faltan datos");
    }

    const buscarCarrito = `
        SELECT id_carrito FROM carritos
        WHERE id_cliente = ? AND id_estado = 6
        LIMIT 1
    `;

    db.query(buscarCarrito, [id_cliente], (err, results) => {
        if (err) return res.status(500).send("Error al buscar carrito");

        let idCarrito;

        if (results.length === 0) {
            const fecha = new Date().toISOString().slice(0, 10);

            const crearCarrito = `
                INSERT INTO carritos (fecha_creacion, id_cliente, id_estado)
                VALUES (?, ?, 6)
            `;

            db.query(crearCarrito, [fecha, id_cliente], (err2, result2) => {
                if (err2) return res.status(500).send("Error al crear carrito");

                idCarrito = result2.insertId;
                agregarProducto(idCarrito);
            });
        } else {
            idCarrito = results[0].id_carrito;
            agregarProducto(idCarrito);
        }
    });


    function agregarProducto(id_carrito) {
        const buscarItem = `
            SELECT cantidad FROM items_carrito
            WHERE id_carrito = ? AND id_producto = ?
        `;

        db.query(buscarItem, [id_carrito, id_producto], (err, results) => {
            if (err) return res.status(500).send("Error al verificar item");

            if (results.length > 0) {
                const nuevaCantidad = results[0].cantidad + cantidad;
                const actualizar = `
                    UPDATE items_carrito
                    SET cantidad = ?
                    WHERE id_carrito = ? AND id_producto = ?
                `;
                db.query(actualizar, [nuevaCantidad, id_carrito, id_producto], (err2) => {
                    if (err2) return res.status(500).send("Error al actualizar item");

                    return res.send({
                        mensaje: "Cantidad actualizada",
                        id_carrito,
                        nuevaCantidad
                    });
                });
            } else {
                const insertar = `
                    INSERT INTO items_carrito (id_carrito, id_producto, cantidad)
                    VALUES (?, ?, ?)
                `;

                db.query(insertar, [id_carrito, id_producto, cantidad], (err3) => {
                    if (err3) return res.status(500).send("Error al agregar item");

                    return res.send({
                        mensaje: "Producto agregado al carrito",
                        id_carrito,
                        id_producto,
                        cantidad
                    });
                });
            }
        });
    }
});
app.put("/carrito/actualizar", (req, res) => {         
    const { id_cliente, id_producto, cantidad } = req.body;

    if (!id_cliente || !id_producto || cantidad == null) {
        return res.status(400).send("Faltan datos");
    }

    if (cantidad < 0) {
        return res.status(400).send("La cantidad no puede ser negativa");
    }

    const buscarCarrito = `
        SELECT id_carrito FROM carritos
        WHERE id_cliente = ? AND id_estado = 6
        LIMIT 1
    `;

    db.query(buscarCarrito, [id_cliente], (err, results) => {
        if (err) return res.status(500).send("Error al buscar carrito");

        if (results.length === 0) {
            return res.status(404).send("El cliente no tiene carrito activo");
        }

        const id_carrito = results[0].id_carrito;

        if (cantidad === 0) {
            const eliminarItem = `
                DELETE FROM items_carrito
                WHERE id_carrito = ? AND id_producto = ?
            `;
            db.query(eliminarItem, [id_carrito, id_producto], (err2) => {
                if (err2) return res.status(500).send("Error al eliminar item");

                return res.send({
                    mensaje: "Producto eliminado del carrito",
                    id_carrito,
                    id_producto
                });
            });
            return;
        }

        const actualizarCantidad = `
            UPDATE items_carrito
            SET cantidad = ?
            WHERE id_carrito = ? AND id_producto = ?
        `;

        db.query(actualizarCantidad, [cantidad, id_carrito, id_producto], (err3, result3) => {
            if (err3) return res.status(500).send("Error al actualizar producto");

            if (result3.affectedRows === 0) {
                return res.status(404).send("El producto no existe en el carrito");
            }

            return res.send({
                mensaje: "Cantidad actualizada",
                id_carrito,
                id_producto,
                cantidad
            });
        });
    });
});
app.delete("/carrito/eliminar-item", (req, res) => {  
    const { id_cliente, id_producto } = req.body;

    if (!id_cliente || !id_producto) {
        return res.status(400).send("Faltan datos");
    }

    const buscarCarrito = `
        SELECT id_carrito FROM carritos
        WHERE id_cliente = ? AND id_estado = 6
        LIMIT 1
    `;

    db.query(buscarCarrito, [id_cliente], (err, results) => {
        if (err) return res.status(500).send("Error al buscar carrito");
        if (results.length === 0) return res.status(404).send("No hay carrito activo");

        const id_carrito = results[0].id_carrito;

        const eliminar = `
            DELETE FROM items_carrito
            WHERE id_carrito = ? AND id_producto = ?
        `;

        db.query(eliminar, [id_carrito, id_producto], (err2, result2) => {
            if (err2) return res.status(500).send("Error al eliminar producto");

            return res.send({
                mensaje: "Producto eliminado del carrito",
                id_carrito,
                id_producto
            });
        });
    });
});
app.delete("/carrito/vaciar", (req, res) => { 
    const { id_cliente } = req.body;

    if (!id_cliente) return res.status(400).send("Falta id_cliente");

    const buscarCarrito = `
        SELECT id_carrito FROM carritos
        WHERE id_cliente = ? AND id_estado = 6
        LIMIT 1
    `;

    db.query(buscarCarrito, [id_cliente], (err, results) => {
        if (err) return res.status(500).send("Error al buscar carrito");
        if (results.length === 0) return res.status(404).send("El cliente no tiene carrito activo");

        const id_carrito = results[0].id_carrito;

        const eliminarTodo = `
            DELETE FROM items_carrito
            WHERE id_carrito = ?
        `;

        db.query(eliminarTodo, [id_carrito], (err2) => {
            if (err2) return res.status(500).send("Error al vaciar carrito");

            return res.send({
                mensaje: "Carrito vaciado correctamente",
                id_carrito
            });
        });
    });
});

app.get("/carrito/total", (req, res) => { 
    const id_cliente = req.query.id_cliente;

    const sql = `
        SELECT SUM(i.cantidad * p.precio) AS total
        FROM items_carrito i
        JOIN productos p ON p.id_producto = i.id_producto
        JOIN carritos c ON c.id_carrito = i.id_carrito
        WHERE c.id_cliente = ? AND c.id_estado = 6
    `;

    db.query(sql, [id_cliente], (err, result) => {
        if (err) return res.status(500).send("Error al calcular total");
        res.send(result[0]);
    });
});
app.get("/paises", (req, res) => {
    const query = 'SELECT id_pais, nombre FROM paises';

    db.query(query, (err, results) => {
        if (err) return res.status(500).send("Error al obtener países");
        res.json(results);
    });
});
app.get("/ciudades", (req, res) => {
    const { id_pais } = req.query;

    if (!id_pais) return res.status(400).send("Falta el id_pais");

    const query = 'SELECT id_ciudad, nombre FROM ciudades WHERE id_pais = ?';

    db.query(query, [id_pais], (err, results) => {
        if (err) return res.status(500).send("Error al obtener ciudades");
        res.json(results);
    });
});
app.get("/direccion", (req, res) => {
    const { id_cliente } = req.query;

    if (!id_cliente) {
        return res.status(400).send("Falta id_cliente");
    }

    const direcciones_usuario = `
        SELECT d.id_direccion, d.calle, d.distrito, d.referencia, d.codigo_postal,
               c.nombre AS ciudad, p.nombre
        FROM direcciones d
        JOIN ciudades c ON d.id_ciudad = c.id_ciudad
        JOIN paises p ON c.id_pais = p.id_pais
        WHERE d.id_cliente = ?
    `;

    db.query(direcciones_usuario, [id_cliente], (err, results) => {
    if (err) {
        console.log("ERROR SQL DIRECCIONES:", err);
        return res.status(500).json({ error: "Error al buscar direcciones" });
    }
    res.send(results);
});
});
app.post("/direccionAgregar", (req, res) => {
    const { distrito, calle, referencia, codigo_postal, id_cliente, id_ciudad } = req.body;
    if (!distrito || !calle || !referencia || !codigo_postal || !id_cliente || !id_ciudad) {
        return res.status(400).json({ error: "Faltan datos para agregar dirección" });
    }

    const sql = `
        INSERT INTO direcciones (distrito, calle, referencia, codigo_postal, id_cliente, id_ciudad)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [distrito, calle, referencia, codigo_postal, id_cliente, id_ciudad], (err, result) => {
        if (err) return res.status(500).json({ error: "Error al agregar dirección" });
    
        res.json({
            mensaje: "Dirección registrada correctamente",
            id_direccion: result.insertId
        });
    });
});
app.post('/resenas', (req, res) => {
  const { calificacion, puntuacion, id_cliente, id_producto } = req.body;

  const fecha = new Date().toISOString().split("T")[0];

  const query = `
    INSERT INTO resena (calificacion, fecha, puntuacion, id_cliente, id_producto)
    VALUES (?, ?, ?, ?, ?)
  `;
    
  db.query(query, [calificacion, fecha, puntuacion, id_cliente, id_producto], (err) => {
    if (err) return res.status(500).send("Error creando reseña");
    res.json({ mensaje: "Reseña creada" });
  });
});
app.get('/resenas/:id_producto', (req, res) => {
  const { id_producto } = req.params;

  const query = `
    SELECT r.*, c.nombre AS cliente_nombre
    FROM resena r
    LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
    WHERE r.id_producto = ?
    ORDER BY r.fecha DESC
  `;

  db.query(query, [id_producto], (err, result) => {
    if (err) return res.status(500).send("Error obteniendo reseñas");
    res.json(result);
  });
});
app.delete('/resenas/:id_resena', (req, res) => {
  const { id_resena } = req.params;
  const { id_cliente } = req.body;

  const query = `
    DELETE FROM resena
    WHERE id_resena = ? AND id_cliente = ?
  `;

  db.query(query, [id_resena, id_cliente], (err, result) => {
    if (err) return res.status(500).send("Error eliminando reseña");

    if (result.affectedRows === 0)
      return res.status(403).send("No puedes eliminar una reseña que no es tuya");

    res.json({ mensaje: "Reseña eliminada" });
  });
});
app.put('/resenas/:id_resena', (req, res) => {
  const { id_resena } = req.params;
  const { calificacion, puntuacion, id_cliente } = req.body;

  const query = `
    UPDATE resena
    SET calificacion = ?, puntuacion = ?
    WHERE id_resena = ? AND id_cliente = ?
  `;

  db.query(query, [calificacion, puntuacion, id_resena, id_cliente], (err, result) => {
    if (err) return res.status(500).send("Error actualizando reseña");

    if (result.affectedRows === 0)
      return res.status(403).send("No puedes editar una reseña que no es tuya");

    res.json({ mensaje: "Reseña actualizada" });
  });
});

app.get("/deuda", async (req, res) => {
  const dbp = db.promise();
  const { id_carrito } = req.query;

  if (!id_carrito) {
    return res.status(400).json({ error: "Falta id_carrito" });
  }

  try {
    const [rows] = await dbp.execute(`
      SELECT IFNULL(SUM(pc.cantidad * p.precio), 0) AS total
      FROM items_carrito pc
      LEFT JOIN productos p ON pc.id_producto = p.id_producto
      WHERE pc.id_carrito = ?
    `, [id_carrito]);

    const total = rows[0]?.total ?? 0;
    res.json({ deuda: total });

  } catch (err) {
    console.log("[/deuda] ERROR:", err);
    res.status(500).json({ error: "Error al calcular deuda" });
  }
});

app.get("/deudas/:id_cliente", async (req, res) => {
  const { id_cliente } = req.params;
  const dbp = db.promise();

  try {
    const [rows] = await dbp.execute(`
      SELECT 
        pe.id_carrito,
        pe.id_pedido,
        pe.fecha_pedido,
        pe.id_estado,
        COALESCE(SUM(pc.cantidad * p.precio), 0) AS total,
        COALESCE((SELECT SUM(monto) 
                  FROM pagos 
                  WHERE id_pedido = pe.id_pedido), 0) AS pagado,
        COALESCE(SUM(pc.cantidad * p.precio), 0) -
        COALESCE((SELECT SUM(monto) 
                  FROM pagos 
                  WHERE id_pedido = pe.id_pedido), 0) AS deuda
      FROM pedidos pe
      JOIN carritos c ON pe.id_carrito = c.id_carrito
      JOIN items_carrito pc ON c.id_carrito = pc.id_carrito
      JOIN productos p ON pc.id_producto = p.id_producto
      WHERE c.id_cliente = ? AND pe.id_estado = 4
      GROUP BY pe.id_pedido
      ORDER BY pe.fecha_pedido DESC
    `, [id_cliente]);

    res.json(rows || []);
  } catch (err) {
    console.error("ERROR listando deudas:", err);
    res.json([]);
  }
});

app.post("/pagos/registrar", async (req, res) => {
  const { id_pedido, metodo_pago, monto } = req.body;

  if (!id_pedido || !monto || !metodo_pago)
    return res.status(400).json({ error: "Faltan datos" });

  const dbp = db.promise();

  try {

    const [rows] = await dbp.execute(`
      SELECT 
        (SELECT SUM(pc.cantidad * p.precio)
         FROM pedidos pe
         JOIN carritos c ON pe.id_carrito = c.id_carrito
         JOIN items_carrito pc ON c.id_carrito = pc.id_carrito
         JOIN productos p ON pc.id_producto = p.id_producto
         WHERE pe.id_pedido = ?) 
        -
        (SELECT IFNULL(SUM(monto),0) 
         FROM pagos WHERE id_pedido = ?) AS deuda
    `, [id_pedido, id_pedido]);

    const deudaActual = Number(rows[0].deuda || 0);

    if (Number(monto) > deudaActual)
      return res.status(400).json({ error: "No puedes pagar más de la deuda" });

    await dbp.execute(`
      INSERT INTO pagos (metodo_pago, fecha_pago, monto, id_pedido)
      VALUES (?, CURDATE(), ?, ?)
    `, [metodo_pago, monto, id_pedido]);

    const [rows2] = await dbp.execute(`
      SELECT 
        (SELECT SUM(pc.cantidad * p.precio)
         FROM pedidos pe
         JOIN carritos c ON pe.id_carrito = c.id_carrito
         JOIN items_carrito pc ON c.id_carrito = pc.id_carrito
         JOIN productos p ON pc.id_producto = p.id_producto
         WHERE pe.id_pedido = ?) 
        -
        (SELECT IFNULL(SUM(monto),0) 
         FROM pagos WHERE id_pedido = ?) AS deuda
    `, [id_pedido, id_pedido]);

    const deudaRestante = Number(rows2[0].deuda || 0);


    if (deudaRestante <= 0) {
      await dbp.execute(
        `UPDATE pedidos SET id_estado = 5 WHERE id_pedido = ?`,
        [id_pedido]
      );
    }

    return res.json({ ok: true, deudaRestante });
  } catch (err) {
    console.error("[/pagos/registrar] ERROR:", err);
    res.status(500).json({ error: "Error al registrar pago" });
  }
});

app.post("/pedido/crear", async (req, res) => {
  const { id_carrito, id_direccion, fecha_pedido, id_estado } = req.body;
  const dbp = db.promise();

  try {
    const resp = await dbp.execute(`
      INSERT INTO pedidos (id_carrito, id_direccion, fecha_pedido, id_estado)
      VALUES (?, ?, ?, ?)
    `, [id_carrito, id_direccion, fecha_pedido, id_estado]);
 
    await dbp.execute(
      `UPDATE carritos SET id_estado = 7 WHERE id_carrito = ?`,
      [id_carrito]
    );

    const fecha = new Date().toISOString().slice(0, 10);

    const [nuevoCarrito] = await dbp.execute(`
      INSERT INTO carritos (fecha_creacion, id_cliente, id_estado)
      SELECT ?, id_cliente, 6
      FROM carritos WHERE id_carrito = ?
    `, [fecha, id_carrito]);

    const id_nuevo_carrito = nuevoCarrito.insertId;

    res.json({
      ok: true,
      id_pedido: resp[0].insertId,
      nuevo_carrito: id_nuevo_carrito
    });

  } catch (err) {
    console.error("[/pedido/crear] ERROR:", err);
    res.status(500).json({ error: "No se pudo crear el pedido" });
  }
});

app.get("/pagos/deuda/:id_pedido", async (req, res) => {
  const { id_pedido } = req.params;
  const dbp = db.promise();

  try {
    const [rows] = await dbp.execute(`
      SELECT 
        IFNULL(
          (SELECT SUM(pc.cantidad * p.precio)
           FROM pedidos pe
           JOIN carritos c ON pe.id_carrito = c.id_carrito
           JOIN items_carrito pc ON c.id_carrito = pc.id_carrito
           JOIN productos p ON pc.id_producto = p.id_producto
           WHERE pe.id_pedido = ?
          ), 
        0)
        -
        IFNULL(
          (SELECT SUM(monto) FROM pagos WHERE id_pedido = ?),
        0) AS deuda
    `, [id_pedido, id_pedido]);

    return res.json({ deuda: Number(rows[0].deuda) });

  } catch (err) {
    console.error("[/pagos/deuda] ERROR:", err);
    return res.status(500).json({ error: "Error obteniendo deuda" });
  }
});


app.get("/pagos/:id_pedido", async (req, res) => {
  const { id_pedido } = req.params;
  const dbp = db.promise();

  try {
    const [rows] = await dbp.execute(`
      SELECT id_pago, metodo_pago, monto, fecha_pago
      FROM pagos
      WHERE id_pedido = ?
      ORDER BY fecha_pago ASC
    `, [id_pedido]);

    res.json(rows || []);
  } catch (err) {
    console.error("ERROR listando pagos:", err);
    res.status(500).json({ error: "Error listando pagos" });
  }
});

app.get("/compras/:id_cliente", async (req, res) => {
  const { id_cliente } = req.params;
  const dbp = db.promise();

  try {
    const [rows] = await dbp.execute(`
      SELECT 
        pe.id_pedido,
        pe.id_carrito,
        pe.fecha_pedido,
        COALESCE(SUM(pc.cantidad * p.precio), 0) AS total,
        COALESCE((SELECT SUM(monto) FROM pagos WHERE id_pedido = pe.id_pedido), 0) AS pagado
      FROM pedidos pe
      JOIN carritos c ON pe.id_carrito = c.id_carrito
      JOIN items_carrito pc ON c.id_carrito = pc.id_carrito
      JOIN productos p ON pc.id_producto = p.id_producto
      WHERE c.id_cliente = ? AND pe.id_estado = 5
      GROUP BY pe.id_pedido
      ORDER BY pe.fecha_pedido DESC
    `, [id_cliente]);

    res.json(rows || []);
  } catch (err) {
    console.error("ERROR listando compras:", err);
    res.json([]);
  }
});

app.post('/votar', (req, res) => {
    const { idCliente, idEncuesta, idDetalle } = req.body;

    const sqlInsert = `
        INSERT INTO votos_encuestas (fecha_voto, id_cliente, id_detalle, id_encuesta)
        VALUES (CURDATE(), ?, ?, ?)
    `;

    db.query(sqlInsert, [idCliente, idDetalle, idEncuesta], (err, result) => {
        if (err) return res.status(400).json({ error: "Ya votaste en esta encuesta" });

        const sqlUpdate = `
            UPDATE detalles_encuestas
            SET votos = votos + 1
            WHERE id_detalle = ? AND id_encuesta = ?
        `;

        db.query(sqlUpdate, [idDetalle, idEncuesta], () => {
            res.json({ msg: "Voto registrado" });
        });
    });
});

app.get('/ya-voto/:idCliente/:idEncuesta', (req, res) => {
    const { idCliente, idEncuesta } = req.params;

    const sql = `
        SELECT * FROM votos_encuestas
        WHERE id_cliente = ? AND id_encuesta = ?
    `;

    db.query(sql, [idCliente, idEncuesta], (err, result) => {
        if (err) return res.status(500).json({ error: "Error" });

        res.json({ yaVoto: result.length > 0 });
    });
});

app.get('/detalles-encuesta/:id', (req, res) => {
    const { id } = req.params;

    const sql = `
        SELECT * FROM detalles_encuestas 
        WHERE id_encuesta = ?
    `;
    db.query(sql, [id], (err, result) => {
        if(err) return res.status(500).json({ error: "Error BD" });
        res.json(result);
    });
});


app.get("/encuesta_ganadora/:id_encuesta", (req, res) => {
  const { id_encuesta } = req.params;

  const sql = `
    SELECT 
      id_detalle,
      opcion_equipo,
      opcion_liga,
      categoria,
      votos
    FROM detalles_encuestas
    WHERE id_encuesta = ?
    ORDER BY votos DESC
    LIMIT 1;
  `;

  db.query(sql, [id_encuesta], (err, rows) => {
    if (err) return res.status(500).json({ error: err });

    if (!rows || rows.length === 0)
      return res.json({ opcion: null, votos: 0 });

    const d = rows[0];

    let opcion = d.opcion_equipo || d.opcion_liga || d.categoria;

    res.json({
      opcion,
      votos: Number(d.votos)
    });
  });
});


app.post("/categorias", (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).send("Falta el nombre.");

  const sql = "INSERT INTO categoria (nombre) VALUES (?)";

  db.query(sql, [nombre], (err, result) => {
    if (err) return res.status(500).json({ error: err });

    res.json({ message: "Categoría agregada", id: result.insertId });
  });
});


app.delete("/categorias/:id", (req, res) => {
  const sql = "DELETE FROM categoria WHERE id_categoria = ?";

  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err });

    if (result.affectedRows === 0)
      return res.status(404).send("Categoría no encontrada");

    res.json({ message: "Categoría eliminada" });
  });
});




app.post("/equipos", (req, res) => {
  const { nombre, pais } = req.body;
  if (!nombre || !pais) return res.status(400).send("Falta nombre o país.");

  const sql = "INSERT INTO equipos (nombre, pais) VALUES (?, ?)";

  db.query(sql, [nombre, pais], (err, result) => {
    if (err) return res.status(500).json({ error: err });

    res.json({ message: "Equipo agregado", id: result.insertId });
  });
});


app.delete("/equipos/:id", (req, res) => {
  const sql = "DELETE FROM equipos WHERE id_equipo = ?";

  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err });

    if (result.affectedRows === 0)
      return res.status(404).send("Equipo no encontrado");

    res.json({ message: "Equipo eliminado" });
  });
});




app.post("/marcas", (req, res) => {
  const { nombre, pais } = req.body;
  if (!nombre || !pais) return res.status(400).send("Falta nombre o país.");

  const sql = "INSERT INTO marcas (nombre, pais) VALUES (?, ?)";

  db.query(sql, [nombre, pais], (err, result) => {
    if (err) return res.status(500).json({ error: err });

    res.json({ message: "Marca agregada", id: result.insertId });
  });
});


app.delete("/marcas/:id", (req, res) => {
  const sql = "DELETE FROM marcas WHERE id_marca = ?";

  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err });

    if (result.affectedRows === 0)
      return res.status(404).send("Marca no encontrada");

    res.json({ message: "Marca eliminada" });
  });
});


app.post("/competencias", (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).send("Falta nombre.");

  const sql = "INSERT INTO competencias (nombre) VALUES (?)";

  db.query(sql, [nombre], (err, result) => {
    if (err) return res.status(500).json({ error: err });

    res.json({ message: "Competencia agregada", id: result.insertId });
  });
});


app.delete("/competencias/:id", (req, res) => {
  const sql = "DELETE FROM competencias WHERE id_competencia = ?";

  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err });

    if (result.affectedRows === 0)
      return res.status(404).send("Competencia no encontrada");

    res.json({ message: "Competencia eliminada" });
  });
});

app.get("/boleta/:id_pedido", async (req, res) => {
  const { id_pedido } = req.params;
  const dbp = db.promise();

  try {
    const [rows] = await dbp.execute(`
      SELECT 
          pe.id_pedido,
          pe.fecha_pedido,
          pr.nombre AS producto_nombre,
          pr.caracteristica,
          pr.precio,
          ic.cantidad,
          c.nombre AS categoria,
          co.nombre AS competencia,
          e.nombre AS equipo,
          e.pais AS pais_equipo,
          p.metodo_pago,
          p.fecha_pago,
          p.monto AS pago_monto
      FROM pedidos pe
      JOIN carritos ca ON pe.id_carrito = ca.id_carrito
      JOIN items_carrito ic ON ca.id_carrito = ic.id_carrito
      JOIN productos pr ON ic.id_producto = pr.id_producto
      LEFT JOIN categoria c ON pr.id_categoria = c.id_categoria
      LEFT JOIN competencias co ON pr.id_competencia = co.id_competencia
      LEFT JOIN equipos e ON e.id_equipo = pr.id_competencia
      LEFT JOIN pagos p ON pe.id_pedido = p.id_pedido
      WHERE pe.id_pedido = ?
    `, [id_pedido]);

    if (!rows.length) return res.status(404).send("Pedido no encontrado");

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=boleta_${id_pedido}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).text(`Boleta Pedido #${id_pedido}`, { align: "center" });
    
const fechaEmision = new Date().toLocaleDateString("es-PE", {
  day: "2-digit",
  month: "long",
  year: "numeric"
});
doc.fontSize(12).text(`Fecha de emisión: ${fechaEmision}`);
const fechaEmision2 = rows[0].fecha_pedido.toLocaleDateString("es-PE", {
  day: "2-digit",
  month: "long",
  year: "numeric"
});
doc.fontSize(12).text(`Fecha del pedido: ${fechaEmision2}\n\n`);
   
    const productos = [];
    const seenProductos = new Set();
    rows.forEach(r => {
      const key = `${r.producto_nombre}-${r.cantidad}`;
      if (!seenProductos.has(key)) {
        productos.push(r);
        seenProductos.add(key);
      }
    });

    doc.fontSize(16).text("Productos comprados:");
    productos.forEach((r, idx) => {
      doc
        .fontSize(12)
        .text(`${idx + 1}. ${r.producto_nombre} (${r.categoria || "-"})`)
        .text(`   Características: ${r.caracteristica || "-"}`)
        .text(`   Precio: S/. ${r.precio}`)
        .text(`   Cantidad: ${r.cantidad}`)
        .text(`   Competencia: ${r.competencia || "-"}`)
        .text(`   Equipo: ${r.equipo || "-"} (${r.pais_equipo || "-"})\n`);
    });


    const pagos = [];
    const seenPagos = new Set();
    rows.forEach(r => {
      if (r.metodo_pago) {
        const key = `${r.metodo_pago}-${r.fecha_pago}-${r.pago_monto}`;
        if (!seenPagos.has(key)) {
          pagos.push(r);
          seenPagos.add(key);
        }
      }
    });

    doc.moveDown();
    doc.fontSize(16).text("Pagos realizados:");
    pagos.forEach((r, idx) => {
  const fechaPago = new Date(r.fecha_pago).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  doc
    .fontSize(12)
    .text(`Pago ${idx + 1} - ${r.metodo_pago}: S/. ${r.pago_monto} (${fechaPago})`);
});

    const total = productos.reduce((acc, r) => acc + r.precio * r.cantidad, 0);
    doc.moveDown();
    doc.fontSize(14).text(`Total pagado: S/. ${total}`, { align: "right" });

    doc.end();

  } 
  catch (err) {
    console.error(err);
    res.status(500).send("Error generando boleta");
  }
});
