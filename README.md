# Gardu Induk 150/20 kV — 3D + SLD

Model 3D yang bisa dijelajahi dan diagram satu garis (SLD) gardu induk distribusi 150/20 kV.

- **8 konfigurasi:** single busbar, single busbar bersekat, rel utama + transfer, double busbar, 1½ breaker, double breaker, ring bus, skema H
- **AIS / GIS** untuk setiap konfigurasi
- **Ketuk komponen** untuk melihat nama (istilah PLN + Inggris) dan fungsinya
- **Simulasi:** buka/tutup PMT dan PMS (dengan interlock), simulasikan gangguan rel/saluran/trafo/penyulang
- **Kamera:** orbit, tampak atas, mode jalan setinggi mata (joystick di HP, WASD di desktop)

Data topologi ada di `src/model.js` dan menjadi satu sumber untuk 3D (`src/scene3d.js`), SLD (`src/sld.js`) dan simulasi (`src/sim.js`).

## Menjalankan

Situs statis tanpa build. Jalankan server statis apa pun dari root repo, misalnya:

```
python3 -m http.server 8000
```

lalu buka `http://localhost:8000`. Three.js r170 sudah disertakan di `vendor/` (lisensi MIT).

Dimensi mendekati nyata, disederhanakan untuk memahami denah.
