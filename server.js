const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3000;

app.use(express.static("public"));

let players = {};
let bullets = [];
let nextBulletId = 0;

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1200;

const walls = [
  { x: 0, y: 0, width: MAP_WIDTH, height: 30 },          
  { x: 0, y: MAP_HEIGHT - 30, width: MAP_WIDTH, height: 30 },
  { x: 0, y: 0, width: 30, height: MAP_HEIGHT },         
  { x: MAP_WIDTH - 30, y: 0, width: 30, height: MAP_HEIGHT },
  { x: 300, y: 200, width: 300, height: 30 },
  { x: 800, y: 400, width: 30, height: 300 },
  { x: 600, y: 600, width: 400, height: 30 },
  { x: 1000, y: 200, width: 30, height: 400 },
  { x: 1500, y: 700, width: 30, height: 300 },
  { x: 1300, y: 1000, width: 400, height: 30 },
  { x: 400, y: 800, width: 200, height: 30 },
];

// 🔁 Nouvelle fonction pour choisir une position de spawn sûre
function getSafeSpawnPosition() {
  let safe = false;
  let x, y;
  while (!safe) {
    x = 100 + Math.random() * (MAP_WIDTH - 200);
    y = 100 + Math.random() * (MAP_HEIGHT - 200);
    const collides = walls.some(w =>
      x + 20 > w.x && x - 20 < w.x + w.width &&
      y + 20 > w.y && y - 20 < w.y + w.height
    );
    if (!collides) safe = true;
  }
  return { x, y };
}

io.on("connection", socket => {
  console.log("Nouvelle connexion:", socket.id);

  const { x, y } = getSafeSpawnPosition();

  players[socket.id] = {
    id: socket.id,
    x,
    y,
    angle: 0,
    health: 100,
    ammo: 15,
    reloading: false,
    dead: false,
    input: { up: false, down: false, left: false, right: false },
    dashing: false,
    lastDash: 0,
    name: "Anonymous",
    kills: 0,
    deaths: 0
  };

  socket.emit("init", { id: socket.id, players, bullets, walls });
  socket.broadcast.emit("newPlayer", players[socket.id]);

  socket.on("setName", (name) => {
    if(players[socket.id]) {
      players[socket.id].name = name;
      io.emit("state", { players, bullets, walls });
    }
  });

  socket.on("input", data => {
    const p = players[socket.id];
    if (!p || p.dead) return;
    p.input = data.input;
    p.angle = data.angle;
  });

  socket.on("dash", () => {
    const p = players[socket.id];
    const now = Date.now();
    if (p && !p.dead && now - p.lastDash > 1000) {
      p.dashing = true;
      p.lastDash = now;
      setTimeout(() => {
        if (players[socket.id]) players[socket.id].dashing = false;
      }, 400);
    }
  });

  socket.on("reload", () => {
    const p = players[socket.id];
    if (p && !p.reloading && p.ammo < 15) {
      p.reloading = true;
      setTimeout(() => {
        p.ammo = 15;
        p.reloading = false;
      }, 2000);
    }
  });

  socket.on("shoot", () => {
    const p = players[socket.id];
    if (p && !p.dead && p.ammo > 0 && !p.reloading) {
      bullets.push({
        id: nextBulletId++,
        x: p.x,
        y: p.y,
        angle: p.angle,
        owner: socket.id
      });
      p.ammo--;
      if (p.ammo <= 0) {
        p.reloading = true;
        setTimeout(() => {
          p.ammo = 15;
          p.reloading = false;
        }, 3000);
      }
    }
  });

  socket.on("slash", () => {
    const player = players[socket.id];
    if (!player || player.dead) return;
  
    const now = Date.now();
    if (player.lastSlash && now - player.lastSlash < 1500) return;
    player.lastSlash = now;
  
    const range = 50;
  
    Object.values(players).forEach(target => {
      if (target.id === player.id || target.dead) return;
      const dx = target.x - player.x;
      const dy = target.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < range) {
        target.health -= 50;
        if (target.health <= 0) {
          target.dead = true;
          player.kills++;
          target.deaths++;
        }
      }
    });
  
    // On envoie la position ET l'angle pour l'animation côté client
    io.emit("slashEffect", {
      playerId: player.id,
      x: player.x,
      y: player.y,
      angle: player.angle,
    });
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
  });
});

setInterval(() => {
  const baseSpeed = 4;
  const dashSpeed = 8;

  // === Collision entre joueurs ===
  const playerList = Object.values(players);
  for (let i = 0; i < playerList.length; i++) {
    for (let j = i + 1; j < playerList.length; j++) {
      const p1 = playerList[i];
      const p2 = playerList[j];
      if (p1.dead || p2.dead) continue;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy);
      const minDist = 40; // diamètre des joueurs (20 + 20)

      if (dist < minDist && dist > 0) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;

        // Repousser les deux joueurs de moitié chacun
        p1.x -= nx * overlap / 2;
        p1.y -= ny * overlap / 2;
        p2.x += nx * overlap / 2;
        p2.y += ny * overlap / 2;
      }
    }
  }


  Object.values(players).forEach(p => {
    if (p.dead) return;

    let dx = 0, dy = 0;
    if (p.input.up) dy -= 1;
    if (p.input.down) dy += 1;
    if (p.input.left) dx -= 1;
    if (p.input.right) dx += 1;

    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
      const speed = p.dashing ? dashSpeed : baseSpeed;
      let newX = p.x + dx * speed;
      let newY = p.y + dy * speed;

      const collides = walls.some(w =>
        newX + 20 > w.x && newX - 20 < w.x + w.width &&
        newY + 20 > w.y && newY - 20 < w.y + w.height
      );

      if (!collides) {
        p.x = newX;
        p.y = newY;
      }
    }
  });

  bullets.forEach(b => {
    const newX = b.x + Math.cos(b.angle) * 10;
    const newY = b.y + Math.sin(b.angle) * 10;

    const hitsWall = walls.some(w =>
      newX > w.x && newX < w.x + w.width &&
      newY > w.y && newY < w.y + w.height
    );

    if (hitsWall) {
      b.hit = true;
      return;
    }

    b.x = newX;
    b.y = newY;

    Object.values(players).forEach(p => {
      if (p.id !== b.owner && !p.dead) {
        const dist = Math.hypot(p.x - b.x, p.y - b.y);
        if (dist < 20) {
          b.hit = true;
          p.health -= 10;
          if (p.health <= 0) {
            p.dead = true;
            if (players[b.owner]) {
              players[b.owner].kills++;
            }
            p.deaths++;
            setTimeout(() => {
              const { x, y } = getSafeSpawnPosition();
              p.x = x;
              p.y = y;
              p.health = 100;
              p.ammo = 15;
              p.dead = false;
            }, 5000);
          }
        }
      }
    });
  });

  bullets = bullets.filter(b => !b.hit);

  io.emit("state", { players, bullets, walls });
}, 1000 / 60);

server.listen(PORT, '0.0.0.0', () => console.log("Serveur : http://192.168.175.41:" + PORT));
