const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const compression = require("compression");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  perMessageDeflate: { threshold: 512 }
});

const PORT = 3000;

app.use(compression());
app.use(express.static("public"));

const players = new Map();
let bullets = [];
let nextBulletId = 0;

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1200;
const TICK_RATE = 1000 / 60;

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
  { x: 400, y: 800, width: 200, height: 30 }
];

function getSafeSpawnPosition() {
  let x, y, collides;
  do {
    x = 100 + Math.random() * (MAP_WIDTH - 200);
    y = 100 + Math.random() * (MAP_HEIGHT - 200);
    collides = walls.some(w =>
      x + 20 > w.x && x - 20 < w.x + w.width &&
      y + 20 > w.y && y - 20 < w.y + w.height
    );
  } while (collides);
  return { x, y };
}

io.on("connection", socket => {
  const { x, y } = getSafeSpawnPosition();
  let player = null;

  socket.on('setName', name => {
    if (player) return;
    player = { id: socket.id, name };
    players.set(socket.id, {
      id: socket.id, x, y, angle: 0, health: 100, ammo: 15, reloading: false,
      dead: false, input: { up: false, down: false, left: false, right: false },
      dashing: false, lastDash: 0, name: name || "Anonymous", kills: 0, deaths: 0
    });

    socket.emit("init", { id: socket.id, players: Object.fromEntries(players), bullets, walls });
    socket.broadcast.emit("newPlayer", players.get(socket.id));
  });

  socket.on("input", data => {
    const p = players.get(socket.id);
    if (p && !p.dead) {
      p.input = data.input;
      p.angle = data.angle;
    }
  });

  socket.on("dash", () => {
    const p = players.get(socket.id);
    const now = Date.now();
    if (p && !p.dead && now - p.lastDash > 1000) {
      p.dashing = true;
      p.lastDash = now;
      setTimeout(() => p.dashing = false, 400);
    }
  });

  socket.on("reload", () => {
    const p = players.get(socket.id);
    if (p && !p.reloading && p.ammo < 15) {
      p.reloading = true;
      setTimeout(() => {
        p.ammo = 15;
        p.reloading = false;
      }, 2000);
    }
  });

  socket.on("shoot", () => {
    const p = players.get(socket.id);
    if (p && !p.dead && p.ammo > 0 && !p.reloading) {
      bullets.push({ id: nextBulletId++, x: p.x, y: p.y, angle: p.angle, owner: socket.id });
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
    const player = players.get(socket.id);
    if (!player || player.dead) return;
    const now = Date.now();
    if (player.lastSlash && now - player.lastSlash < 1500) return;
    player.lastSlash = now;

    for (let target of players.values()) {
      if (target.id !== player.id && !target.dead) {
        const dist = Math.hypot(target.x - player.x, target.y - player.y);
        if (dist < 50) {
          target.health -= 50;
          if (target.health <= 0) {
            target.dead = true;
            player.kills++;
            target.deaths++;
          }
        }
      }
    }

    io.emit("slashEffect", { playerId: player.id, x: player.x, y: player.y, angle: player.angle });
  });

  socket.on('disconnect', () => {
    if (!player) return;
    players.delete(socket.id);
    socket.broadcast.emit('removePlayer', socket.id);
  });
});

setInterval(() => {
  for (let p of players.values()) {
    if (p.dead) continue;

    let dx = 0, dy = 0;
    if (p.input.up) dy -= 1;
    if (p.input.down) dy += 1;
    if (p.input.left) dx -= 1;
    if (p.input.right) dx += 1;

    const len = Math.hypot(dx, dy);
    if (len) {
      dx /= len;
      dy /= len;
      const speed = p.dashing ? 8 : 4;
      const newX = p.x + dx * speed;
      const newY = p.y + dy * speed;

      const collidesWithWall = walls.some(w =>
        newX + 20 > w.x && newX - 20 < w.x + w.width &&
        newY + 20 > w.y && newY - 20 < w.y + w.height
      );

      let collidesWithPlayer = false;
      for (let other of players.values()) {
        if (other.id !== p.id && !other.dead) {
          const dist = Math.hypot(other.x - newX, other.y - newY);
          if (dist < 40) {
            collidesWithPlayer = true;
            break;
          }
        }
      }

      if (!collidesWithWall && !collidesWithPlayer) {
        p.x = newX;
        p.y = newY;
      }
    }
  }

  bullets = bullets.filter(b => {
    const newX = b.x + Math.cos(b.angle) * 10;
    const newY = b.y + Math.sin(b.angle) * 10;

    const hitsWall = walls.some(w =>
      newX > w.x && newX < w.x + w.width &&
      newY > w.y && newY < w.y + w.height
    );

    if (hitsWall) return false;

    b.x = newX;
    b.y = newY;

    for (let p of players.values()) {
      if (p.id !== b.owner && !p.dead) {
        if (Math.hypot(p.x - b.x, p.y - b.y) < 20) {
          p.health -= 10;
          if (p.health <= 0 && !p.dead && !p.respawning) {
            p.dead = true;
            p.respawning = true;
            const owner = players.get(b.owner);
            if (owner) owner.kills++;
            p.deaths++;

            setTimeout(() => {
              const player = players.get(p.id);
              if (!player) return;
              const { x, y } = getSafeSpawnPosition();
              player.x = x;
              player.y = y;
              player.health = 100;
              player.ammo = 15;
              player.dead = false;
              player.respawning = false;

              io.emit('playerRespawn', { id: player.id, x: player.x, y: player.y });
            }, 3000);
          }
          return false;
        }
      }
    }
    return true;
  });

  io.emit("state", { players: Object.fromEntries(players), bullets, walls });
}, TICK_RATE);

server.listen(PORT, "0.0.0.0", () => console.log(`Serveur : http://localhost:${PORT}`));
