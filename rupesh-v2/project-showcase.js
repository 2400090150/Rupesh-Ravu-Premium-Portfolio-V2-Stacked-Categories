(function () {
  'use strict';

  var section = document.getElementById('projectShowcase');
  var mount = document.getElementById('projectShowcaseMount');
  var pill = document.getElementById('projectShowcasePill');
  if (!section || !mount || !pill || typeof THREE === 'undefined') return;

  var LOGO_BACKGROUNDS = [
    ['#FF6036', '#FFB199'],
    ['#3B5BFF', '#9db0ff'],
    ['#2E8B57', '#a8dcc0'],
    ['#FF3D81', '#ffb3cf'],
    ['#0E7C86', '#9fe0e5'],
    ['#7a5cff', '#cfc4ff'],
    ['#F5A524', '#fde0a8'],
    ['#1BA1F2', '#b5e2fb'],
    ['#B51F6B', '#f5b4d2'],
    ['#495867', '#c5d0dc']
  ];

  var projects = [];
  var FALLBACK = [
    { title: 'Northwind Rebrand', image: 'assets/gallery/Wave Front Media.png' },
    { title: 'Atlas Mobile App', image: 'assets/gallery/ORA (2).png' },
    { title: 'Lumen Studio', image: 'assets/gallery/floura and faouna.png' },
    { title: 'Orbit Dashboard', image: 'assets/gallery/ELEVate co..png' },
    { title: 'Fern & Co.', image: 'assets/gallery/Nomad Travel.png' },
    { title: 'Pulse Fitness', image: 'assets/gallery/work-04.jpg' },
    { title: 'Tidal Records', image: 'assets/gallery/work-02.jpg' },
    { title: 'Monolith Archive', image: 'assets/gallery/work-06.jpg' },
    { title: 'Saffron Kitchen', image: 'assets/gallery/Package design 1.png' },
    { title: 'Kite Airlines', image: 'assets/gallery/Package design 2.png' }
  ];

  function getProjectsFromPortfolio(portfolio) {
    var loaded = [];
    if (Array.isArray(portfolio.showcase) && portfolio.showcase.length) {
      portfolio.showcase.forEach(function (design) {
        loaded.push({ title: design.title, image: design.image, category: design.category });
      });
    } else {
      (portfolio.categories || []).forEach(function (category) {
        (category.designs || []).forEach(function (design) {
          loaded.push({ title: design.title, image: design.image, category: category.slug });
        });
      });
    }
    return loaded;
  }

  function assignLogoBackgrounds(items) {
    var logoIndex = 0;
    return items.map(function (project) {
      if (project.category !== 'logo-designs') return project;
      var isWaveFrontMedia = String(project.title || '').trim().toLowerCase() === 'wave front media';
      var coloredProject = Object.assign({}, project, {
        logoBackground: isWaveFrontMedia
          ? ['#000000', '#000000']
          : LOGO_BACKGROUNDS[logoIndex % LOGO_BACKGROUNDS.length]
      });
      logoIndex++;
      return coloredProject;
    });
  }

  async function loadProjects() {
    try {
      var response = await fetch('/api/portfolio', { cache: 'no-store' });
      if (!response.ok) throw new Error('Portfolio request failed with HTTP ' + response.status);
      projects = assignLogoBackgrounds(getProjectsFromPortfolio(await response.json()));
    } catch (error) {
      console.warn('Could not load portfolio projects for the showcase.', error);
    }
    if (!projects.length) projects = FALLBACK.slice();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCover(project, index, image) {
    var canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 760;
    var ctx = canvas.getContext('2d');
    roundRect(ctx, 0, 0, 640, 760, 56);
    ctx.save();
    ctx.clip();

    if (project.category === 'logo-designs') {
      var logoBackground = project.logoBackground || LOGO_BACKGROUNDS[index % LOGO_BACKGROUNDS.length];
      var gradient = ctx.createLinearGradient(0, 0, 640, 760);
      gradient.addColorStop(0, logoBackground[0]);
      gradient.addColorStop(1, logoBackground[1]);
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = '#777777';
    }
    ctx.fillRect(0, 0, 640, 760);

    if (image && image.naturalWidth) {
      var scale = Math.max(640 / image.naturalWidth, 760 / image.naturalHeight);
      ctx.drawImage(
        image,
        (640 - image.naturalWidth * scale) / 2,
        (760 - image.naturalHeight * scale) / 2,
        image.naturalWidth * scale,
        image.naturalHeight * scale
      );
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.beginPath();
      ctx.arc(480, 210, 170, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(128, 610, 120, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f4f1eb';
      ctx.font = '600 54px Helvetica,Arial,sans-serif';
      ctx.fillText(String(index + 1).padStart(2, '0'), 48, 90);
      ctx.font = '600 58px Helvetica,Arial,sans-serif';
      var words = project.title.split(' ');
      words.forEach(function (word, wordIndex) {
        ctx.fillText(word, 48, 630 + wordIndex * 64);
      });
    }
    ctx.restore();
    return canvas;
  }

  async function start() {
    await loadProjects();

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.replaceChildren(renderer.domElement);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    var ring = new THREE.Group();
    scene.add(ring);

    var count = 10;
    var radius = 4.2;
    var segment = 24;
    var step = Math.PI * 2 / count;
    var span = step * .965;
    var cardHeight = 2 * Math.PI * radius / count * .9;
    var cards = [];
    var textures = [];
    var textureVersions = [];

    function setTextureProject(texture, project, index) {
      var version = (textureVersions[index] || 0) + 1;
      textureVersions[index] = version;
      texture.image = drawCover(project, index);
      texture.needsUpdate = true;
      if (!project.image) return;
      var image = new Image();
      if (!/^data:/.test(project.image)) image.crossOrigin = 'anonymous';
      image.onload = function () {
        if (textureVersions[index] !== version) return;
        texture.image = drawCover(project, index, image);
        texture.needsUpdate = true;
      };
      image.onerror = function () {};
      image.src = project.image;
    }

    for (var i = 0; i < count; i++) {
      var geometry = new THREE.PlaneGeometry(1, 1, segment, 1);
      var project = projects[i % projects.length];
      var texture = new THREE.CanvasTexture(drawCover(project, i));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      textures.push(texture);
      setTextureProject(texture, project, i);

      var material = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        side: THREE.FrontSide,
        transparent: true,
        alphaTest: .5
      });
      var mesh = new THREE.Mesh(geometry, material);
      mesh.userData.card = i;
      mesh.frustumCulled = false;
      ring.add(mesh);

      var backGeometry = new THREE.BufferGeometry();
      backGeometry.setAttribute('position', geometry.attributes.position);
      var uv = geometry.attributes.uv.clone();
      for (var u = 0; u < uv.count; u++) uv.setX(u, 1 - uv.getX(u));
      backGeometry.setAttribute('uv', uv);
      backGeometry.setIndex(geometry.index);

      var back = new THREE.Mesh(backGeometry, new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide,
        transparent: true,
        alphaTest: .5
      }));
      back.userData.card = i;
      back.frustumCulled = false;
      ring.add(back);

      var positions = geometry.attributes.position;
      var uv0 = new Float32Array(positions.count * 2);
      for (var j = 0; j < positions.count; j++) {
        uv0[j * 2] = positions.getX(j) + .5;
        uv0[j * 2 + 1] = positions.getY(j);
      }
      cards.push({ mesh: mesh, base: i * step, uv0: uv0 });
    }

    document.addEventListener('portfolio:updated', function (event) {
      var nextProjects = getProjectsFromPortfolio(event.detail || {});
      if (!nextProjects.length) return;
      projects = assignLogoBackgrounds(nextProjects);
      textures.forEach(function (texture, index) {
        setTextureProject(texture, projects[index % projects.length], index);
      });
    });

    var twist = 34 * Math.PI / 180;
    function layout(rotation) {
      cards.forEach(function (card) {
        var positions = card.mesh.geometry.attributes.position;
        for (var j = 0; j < positions.count; j++) {
          var u = card.uv0[j * 2];
          var v = card.uv0[j * 2 + 1];
          var phi = card.base + rotation + (u - .5) * span;
          var sine = Math.sin(phi);
          var cosine = Math.cos(phi);
          var alpha = twist * sine * sine;
          var wave = radius * .09 * Math.sin(2 * phi + .6);
          var height = v * cardHeight;
          positions.setXYZ(
            j,
            radius * sine + height * Math.sin(alpha) * sine,
            wave + height * Math.cos(alpha),
            radius * cosine + height * Math.sin(alpha) * cosine
          );
        }
        positions.needsUpdate = true;
        card.mesh.geometry.computeBoundingSphere();
      });
    }

    function resize() {
      var width = mount.clientWidth || 1;
      var height = mount.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      var distance = radius * 3;
      var halfWidth = radius / .6;
      var halfHeight = Math.max(halfWidth / camera.aspect, radius * 1.05);
      camera.fov = 2 * Math.atan(halfHeight / distance) * 180 / Math.PI;
      camera.position.set(0, 0, distance);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    }

    resize();
    new ResizeObserver(resize).observe(mount);

    var baseTilt = 20 * Math.PI / 180;
    var rotation = 0;
    var dragRotation = 0;
    var targetDragRotation = 0;
    var dragging = false;
    var pointerInside = false;
    var lastX = 0;
    var lastY = 0;
    var tiltOffset = 0;
    var targetTiltOffset = 0;
    var hoverIndex = -1;
    var px = 0;
    var py = 0;
    var ray = new THREE.Raycaster();
    var ndc = new THREE.Vector2();
    var tmp = new THREE.Vector3();
    var fitW = 0;
    var fitH = 0;
    var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var arcSpeed = reduceMotion ? .000065 : .00008;

    function autoRotation(time) {
      return time * arcSpeed;
    }

    function pickCard() {
      var rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width) return -1;
      ndc.set((px - rect.left) / rect.width * 2 - 1, -((py - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      var hit = ray.intersectObjects(ring.children, false)[0];
      if (!hit) return -1;
      var index = hit.object.userData.card;
      var front = cards.map(function (card, cardIndex) {
        return { index: cardIndex, z: Math.cos(card.base + rotation) };
      }).sort(function (a, b) { return b.z - a.z; }).slice(0, 3).map(function (item) { return item.index; });
      return front.indexOf(index) >= 0 ? index : -1;
    }

    function showPill(index) {
      if (index < 0) {
        pill.style.opacity = '0';
        return;
      }
      pill.textContent = projects[index % projects.length].title;
      var rect = mount.getBoundingClientRect();
      var width = pill.offsetWidth;
      var height = pill.offsetHeight;
      var pad = 12;
      var mx = px - rect.left;
      var my = py - rect.top;
      var x = mx + 22;
      if (x + width > rect.width - pad) x = mx - width - 22;
      var y = my + 22;
      if (y + height > rect.height - pad) y = my - height - 22;
      x = Math.min(Math.max(pad, x), Math.max(pad, rect.width - width - pad));
      y = Math.min(Math.max(pad, y), Math.max(pad, rect.height - height - pad));
      pill.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) scale(1)';
      pill.style.opacity = '1';
    }

    function updateHover() {
      var index = pointerInside && !dragging ? pickCard() : -1;
      hoverIndex = index;
      showPill(index);
      renderer.domElement.style.cursor = dragging ? 'grabbing' : index >= 0 ? 'pointer' : 'grab';
    }

    function recenter(snap) {
      ring.updateMatrixWorld(true);
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      cards.forEach(function (card) {
        var positions = card.mesh.geometry.attributes.position;
        for (var j = 0; j < positions.count; j++) {
          tmp.fromBufferAttribute(positions, j).applyMatrix4(card.mesh.matrixWorld).project(camera);
          if (tmp.x < minX) minX = tmp.x;
          if (tmp.x > maxX) maxX = tmp.x;
          if (tmp.y < minY) minY = tmp.y;
          if (tmp.y > maxY) maxY = tmp.y;
        }
      });
      var cx = (minX + maxX) / 2;
      var cy = (minY + maxY) / 2;
      var halfHeight = Math.tan(camera.fov * Math.PI / 360) * camera.position.z;
      var smoothing = snap ? 1 : .08;
      ring.position.x -= cx * halfHeight * camera.aspect * smoothing;
      ring.position.y -= cy * halfHeight * smoothing;
      var w = (maxX - minX) / 2;
      var h = (maxY - minY) / 2;
      if (w > 0 && h > 0) {
        fitW = Math.max(w, fitW * .995);
        fitH = Math.max(h, fitH * .995);
        var targetW = Math.min(.68, 1 - 2 * 40 / (mount.clientWidth || 1));
        var scale = Math.min(targetW / fitW, .76 / fitH);
        var scaleValue = 1 + (scale - 1) * (snap ? 1 : .08);
        var tanHalf = Math.tan(camera.fov * Math.PI / 360) / scaleValue;
        camera.fov = Math.min(100, Math.max(5, 2 * Math.atan(tanHalf) * 180 / Math.PI));
        camera.updateProjectionMatrix();
      }
    }

    function apply(time, snap) {
      ring.rotation.x = baseTilt + tiltOffset + Math.sin(time * 4e-4) * .03;
      ring.rotation.z = Math.sin(time * 3e-4) * .03;
      layout(rotation);
      if (snap) recenter(true);
      renderer.render(scene, camera);
    }

    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.addEventListener('pointerdown', function (event) {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      px = event.clientX;
      py = event.clientY;
      targetDragRotation = dragRotation;
      pill.style.opacity = '0';
      renderer.domElement.setPointerCapture(event.pointerId);
    });

    renderer.domElement.addEventListener('pointermove', function (event) {
      px = event.clientX;
      py = event.clientY;
      pointerInside = true;
      if (!dragging) return;
      var dx = event.clientX - lastX;
      var dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      targetDragRotation += dx * .004;
      targetTiltOffset = Math.max(-.25, Math.min(.25, targetTiltOffset + dy * .0015));
    });

    function finishDrag(event) {
      dragging = false;
      try { renderer.domElement.releasePointerCapture(event.pointerId); } catch (error) {}
      updateHover();
    }
    renderer.domElement.addEventListener('pointerup', finishDrag);
    renderer.domElement.addEventListener('pointercancel', finishDrag);
    renderer.domElement.addEventListener('pointerleave', function () {
      pointerInside = false;
      if (!dragging) updateHover();
    });

    apply(0, true);

    function loop(time) {
      requestAnimationFrame(loop);
      if (!dragging) updateHover();
      dragRotation += (targetDragRotation - dragRotation) * .24;
      rotation = dragRotation + autoRotation(time);
      targetTiltOffset = dragging ? targetTiltOffset : 0;
      tiltOffset += (targetTiltOffset - tiltOffset) * .18;
      apply(time, false);
    }
    requestAnimationFrame(loop);
  }

  start();
})();
