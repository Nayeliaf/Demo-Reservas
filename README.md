# Hotel Booking UI — V3

Esta versión rehace la interfaz tomando como referencia visual la imagen proporcionada:
- estética teal / turquesa + plum
- composición mobile-first
- buscador tipo app de reservas
- selector de fechas en bottom sheet
- selector de huéspedes dinámico
- tarjetas de habitaciones visuales
- resumen lateral
- sección de experiencia/servicios
- formulario de checkout
- dashboard del negocio con estados de habitaciones y calendario

## Personalización rápida

Edita `app.js`, al principio de `CONFIG`, para cambiar:
- nombre del hotel
- habitaciones
- precios
- capacidad
- rutas de fotos

Ejemplo:
`photo:"assets/deluxe.jpg"`

Coloca tus imágenes reales en la carpeta `assets`.

## Importante
La beta guarda las reservas en `localStorage` para poder probarla sin servidor.
Para producción, el control de overbooking debe ejecutarse en backend/base de datos con una operación transaccional.


## V4 — Responsive móvil
Se reforzó el responsive para teléfonos pequeños (incluyendo 360–390 px), safe areas, bottom sheets, tarjetas, formularios, dashboard y tablas/calendario del panel.
