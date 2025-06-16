// Gestion clavier
document.addEventListener("keydown", e => {
    const key = e.key.toLowerCase();
    keys[key] = true;
    switch (key) {
      case "r":
        socket.emit("reload");
        break;
      case "shift":
        socket.emit("dash");
        break;
      case "tab":
        e.preventDefault();
        showStats = true;
        break;
      case " ":
        socket.emit("slash");
        break;
    }
  });
  
  document.addEventListener("keyup", e => {
    const key = e.key.toLowerCase();
    keys[key] = false;
    if (key === "tab") showStats = false;
  });
  
  // Souris
  canvas.addEventListener("mousemove", e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  canvas.addEventListener("mousedown", startShooting);
  canvas.addEventListener("mouseup", stopShooting);
  canvas.addEventListener("mouseleave", stopShooting);


function sendInput() {
    if (!hasJoinedGame) return;
    if (!playerId || !players[playerId]) return;
  
    const rect = canvas.getBoundingClientRect();
    const mouseX = mouse.x - rect.left;
    const mouseY = mouse.y - rect.top;
    const player = players[playerId];
    const angle = Math.atan2(mouseY - canvas.height / 2, mouseX - canvas.width / 2);
  
    socket.emit("input", {
      input: {
        up: keys["z"],
        down: keys["s"],
        left: keys["q"],
        right: keys["d"]
      },
      angle
    });
  }