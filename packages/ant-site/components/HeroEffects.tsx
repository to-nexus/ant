'use client';

import { useEffect, useRef } from 'react';

export function StarfieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = 0;
    let height = 0;

    interface Star { x: number; y: number; r: number; alpha: number; dAlpha: number }
    let stars: Star[] = [];

    interface Shooter {
      x: number; y: number; len: number; speed: number;
      angle: number; alpha: number; width: number; life: number; maxLife: number;
    }
    let shooters: Shooter[] = [];

    function resize() {
      width = canvas!.clientWidth;
      height = canvas!.clientHeight;
      canvas!.width = width * devicePixelRatio;
      canvas!.height = height * devicePixelRatio;
      ctx!.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      initStars();
    }

    function initStars() {
      const count = Math.floor((width * height) / 6000);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.2 + 0.3,
        alpha: Math.random(),
        dAlpha: (Math.random() - 0.5) * 0.02,
      }));
    }

    function spawnShooter() {
      const angle = Math.PI * (0.55 + Math.random() * 0.35);
      shooters.push({
        x: width * (0.3 + Math.random() * 0.7),
        y: -10 + Math.random() * height * 0.3,
        len: 60 + Math.random() * 100,
        speed: 4 + Math.random() * 6,
        angle,
        alpha: 0.7 + Math.random() * 0.3,
        width: 1 + Math.random() * 1.5,
        life: 0,
        maxLife: 60 + Math.random() * 60,
      });
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);

      for (const s of stars) {
        s.alpha += s.dAlpha;
        if (s.alpha <= 0.1 || s.alpha >= 1) s.dAlpha *= -1;
        s.alpha = Math.max(0.1, Math.min(1, s.alpha));
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(200,210,255,${s.alpha * 0.6})`;
        ctx!.fill();
      }

      for (let i = shooters.length - 1; i >= 0; i--) {
        const sh = shooters[i];
        sh.x += Math.cos(sh.angle) * sh.speed;
        sh.y += Math.sin(sh.angle) * sh.speed;
        sh.life++;

        const progress = sh.life / sh.maxLife;
        const fade = progress < 0.1 ? progress / 0.1 : progress > 0.7 ? (1 - progress) / 0.3 : 1;
        const a = sh.alpha * fade;

        const tailX = sh.x - Math.cos(sh.angle) * sh.len;
        const tailY = sh.y - Math.sin(sh.angle) * sh.len;

        const grad = ctx!.createLinearGradient(tailX, tailY, sh.x, sh.y);
        grad.addColorStop(0, `rgba(180,200,255,0)`);
        grad.addColorStop(0.6, `rgba(200,215,255,${a * 0.3})`);
        grad.addColorStop(1, `rgba(220,230,255,${a})`);

        ctx!.beginPath();
        ctx!.moveTo(tailX, tailY);
        ctx!.lineTo(sh.x, sh.y);
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = sh.width;
        ctx!.lineCap = 'round';
        ctx!.stroke();

        const headGlow = ctx!.createRadialGradient(sh.x, sh.y, 0, sh.x, sh.y, 4);
        headGlow.addColorStop(0, `rgba(230,240,255,${a})`);
        headGlow.addColorStop(1, `rgba(230,240,255,0)`);
        ctx!.beginPath();
        ctx!.arc(sh.x, sh.y, 4, 0, Math.PI * 2);
        ctx!.fillStyle = headGlow;
        ctx!.fill();

        if (sh.life >= sh.maxLife || sh.x < -100 || sh.y > height + 100) {
          shooters.splice(i, 1);
        }
      }

      if (Math.random() < 0.025 && shooters.length < 4) {
        spawnShooter();
      }

      animId = requestAnimationFrame(draw);
    }

    resize();
    spawnShooter();
    draw();

    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.85 }}
    />
  );
}

export function FloatingOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div
        className="absolute w-[500px] h-[500px] rounded-full blur-[100px] opacity-20"
        style={{
          background: 'radial-gradient(circle, rgba(99,102,241,0.5) 0%, transparent 70%)',
          top: '10%',
          left: '15%',
          animation: 'orbFloat1 20s ease-in-out infinite',
        }}
      />
      <div
        className="absolute w-[600px] h-[600px] rounded-full blur-[120px] opacity-15"
        style={{
          background: 'radial-gradient(circle, rgba(168,85,247,0.4) 0%, transparent 70%)',
          top: '30%',
          right: '10%',
          animation: 'orbFloat2 25s ease-in-out infinite',
        }}
      />
      <div
        className="absolute w-[400px] h-[400px] rounded-full blur-[80px] opacity-15"
        style={{
          background: 'radial-gradient(circle, rgba(20,184,166,0.4) 0%, transparent 70%)',
          bottom: '15%',
          left: '40%',
          animation: 'orbFloat3 18s ease-in-out infinite',
        }}
      />
    </div>
  );
}
