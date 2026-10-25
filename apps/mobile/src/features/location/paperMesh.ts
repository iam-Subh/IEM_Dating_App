type Point = {x: number; y: number; z: number};
type PaperNode = {flat: Point; ball: Point; crease: number};
type PaperMesh = {nodes: PaperNode[]; faces: number[][]; textures: {x: number; y: number}[]};

export function createPaperMesh(): PaperMesh {
  const count = 12;
  const nodes: PaperNode[] = [];
  const faces: number[][] = [];
  const noise = (x: number, y: number) => {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  for (let row = 0; row <= count; row++) {
    for (let col = 0; col <= count; col++) {
      const edge = row === 0 || col === 0 || row === count || col === count;
      const x = col / count - .5 + (edge ? 0 : (noise(col, row) - .5) * .048);
      const y = row / count - .5 + (edge ? 0 : (noise(row + 30, col) - .5) * .048);
      // Map the square to a rounded silhouette before opening its corners.
      const dx = x * Math.sqrt(1 - 2 * y * y);
      const dy = y * Math.sqrt(1 - 2 * x * x);
      const radial = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const crease = (noise(col + 7, row + 13) - .5) * .105;
      const ridge = 1 + (noise(col + 50, row) - .5) * .16;
      nodes.push({flat: {x, y, z: 0}, ball: {
        x: dx * .55 * ridge, y: dy * .55 * ridge,
        z: Math.sqrt(Math.max(0, 1 - radial * radial)) * .24 + crease,
      }, crease});
    }
  }
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      const a = row * (count + 1) + col, b = a + 1, c = a + count + 1, d = c + 1;
      if ((row + col) % 2) faces.push([a, b, c], [b, d, c]);
      else faces.push([a, b, d], [a, d, c]);
    }
  }
  return {nodes, faces, textures: faces.flatMap(face => face.map(index => ({
    x: (nodes[index].flat.x + .5) * 768, y: (nodes[index].flat.y + .5) * 768,
  })))};
}

export function unfoldPaperMesh(mesh: PaperMesh, progress: number, size: number) {
  'worklet';
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  // Release all four tips together, then relax the creases toward the centre.
  const tipTime = Math.max(0, Math.min(1, p / .32));
  const sheetTime = Math.max(0, Math.min(1, (p - .22) / .78));
  const tipOpen = tipTime * tipTime * (3 - 2 * tipTime);
  const sheetOpen = sheetTime * sheetTime * (3 - 2 * sheetTime);
  const points = mesh.nodes.map(node => {
    const cornerWeight = Math.pow(4 * Math.abs(node.flat.x * node.flat.y), 2);
    const tipAmount = .24 * cornerWeight;
    const eased = tipAmount * tipOpen + (1 - tipAmount) * sheetOpen;
    return {
      x: node.ball.x + (node.flat.x - node.ball.x) * eased,
      y: node.ball.y + (node.flat.y - node.ball.y) * eased,
      z: node.ball.z * (1 - eased) + node.crease * Math.sin(Math.PI * eased) * .45,
    };
  });
  const vertices: {x: number; y: number}[] = [];
  const colors: string[] = [];
  for (const face of mesh.faces) {
    const a = points[face[0]], b = points[face[1]], c = points[face[2]];
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    // Light from the upper left reveals the creases. A flat sheet returns to its original colour.
    const light = Math.max(0, (-nx * .36 - ny * .46 + nz * .81) / length);
    const shade = Math.round(255 * (1 - (1 - p) * (1 - Math.min(1, .48 + light * .64))));
    const color = 'rgb(' + shade + ',' + shade + ',' + shade + ')';
    for (const index of face) {
      const point = points[index];
      vertices.push({x: (point.x + .5) * size, y: (point.y + .5) * size});
      colors.push(color);
    }
  }
  return {vertices, colors};
}
