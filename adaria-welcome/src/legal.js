// Textos legales (condiciones, privacidad, imagen) en ES + EN.
// Responsable: ACTIVOS TURISTICOS VERA, S.L., CIF B-27667542
// Domicilio social: Av. de Bellisens 42 Desp.129, 43204 Reus
// Hotel: C/ Sotavento 7, 04621 Vera-Playa | Contacto legal: legal@petitshotels.es
// Nº Registro H/AL/008

const RAZON_SOCIAL = process.env.LEGAL_RAZON_SOCIAL || 'ACTIVOS TURISTICOS VERA, S.L.';
const CIF = process.env.LEGAL_CIF || 'B-27667542';
const DOM_SOCIAL = process.env.LEGAL_DOMICILIO_SOCIAL || 'Av. de Bellisens 42 Desp.129, 43204 Reus';
const DOM_HOTEL = process.env.LEGAL_DOMICILIO_HOTEL || 'C/ Sotavento 7, 04621 Vera-Playa';
const CONTACTO = process.env.LEGAL_CONTACTO || 'legal@petitshotels.es';
const REGISTRO = process.env.LEGAL_REGISTRO || 'Nº Registro H/AL/008';

const TEXTS = {
  es: {
    tituloCondiciones: 'Condiciones de estancia',
    condiciones: `El titular de la reserva y los acompañantes declaran conocer y aceptar las condiciones ` +
      `generales de contratación del hotel, el reglamento de régimen interior y las tarifas aplicadas. ` +
      `La firma de este documento equivale a la firma de la Ficha de Viajero (parte de entrada) exigida ` +
      `por la normativa de seguridad ciudadana vigente en España.`,
    tituloPrivacidad: 'Información sobre protección de datos (RGPD)',
    privacidad: `Responsable del tratamiento: ${RAZON_SOCIAL}, CIF ${CIF}, con domicilio social en ` +
      `${DOM_SOCIAL} (establecimiento: ${DOM_HOTEL}). Finalidad: gestión de la reserva y de la estancia, ` +
      `cumplimiento de las obligaciones de registro de viajeros y facturación. Legitimación: ejecución del ` +
      `contrato de hospedaje y cumplimiento de obligación legal. Destinatarios: Fuerzas y Cuerpos de ` +
      `Seguridad del Estado (parte de viajeros), no se ceden datos a terceros salvo obligación legal. ` +
      `Derechos: acceso, rectificación, supresión, oposición, limitación y portabilidad dirigiéndose a ` +
      `${CONTACTO}. ${REGISTRO}.`,
    tituloImagen: 'Autorización de uso de imagen (opcional)',
    imagen: `Autorizo a ${RAZON_SOCIAL} a utilizar fotografías tomadas durante mi estancia con fines ` +
      `promocionales del hotel en redes sociales y página web, sin contraprestación económica. Esta ` +
      `autorización es voluntaria y revocable en cualquier momento escribiendo a ${CONTACTO}.`,
    tituloMarketing: 'Comunicaciones comerciales (opcional)',
    marketing: `Acepto recibir comunicaciones comerciales sobre ofertas y novedades del hotel por correo ` +
      `electrónico. Puedo darme de baja en cualquier momento.`,
    consentimientoObligatorio: '(obligatorio)',
    consentimientoOpcional: '(opcional)',
    firmaDeclaracion: 'Firmo electrónicamente aceptando lo anterior y confirmando la veracidad de los datos.'
  },
  en: {
    tituloCondiciones: 'Stay conditions',
    condiciones: `The main guest and companions declare that they know and accept the hotel's general ` +
      `terms of contract, house rules and applicable rates. Signing this document is equivalent to ` +
      `signing the Traveler Registration Form required under Spanish public safety regulations.`,
    tituloPrivacidad: 'Data protection information (GDPR)',
    privacidad: `Data controller: ${RAZON_SOCIAL}, Tax ID ${CIF}, registered office at ${DOM_SOCIAL} ` +
      `(establishment: ${DOM_HOTEL}). Purpose: management of the booking and stay, compliance with legal ` +
      `traveler-registration and invoicing obligations. Legal basis: performance of the accommodation ` +
      `contract and compliance with a legal obligation. Recipients: Spanish State security forces ` +
      `(traveler report); no data is transferred to third parties except where legally required. Rights: ` +
      `access, rectification, erasure, objection, restriction and portability by writing to ${CONTACTO}. ` +
      `${REGISTRO}.`,
    tituloImagen: 'Image usage authorization (optional)',
    imagen: `I authorize ${RAZON_SOCIAL} to use photographs taken during my stay for the hotel's ` +
      `promotional purposes on social media and website, without financial compensation. This ` +
      `authorization is voluntary and may be revoked at any time by writing to ${CONTACTO}.`,
    tituloMarketing: 'Marketing communications (optional)',
    marketing: `I agree to receive commercial communications about the hotel's offers and news by email. ` +
      `I can unsubscribe at any time.`,
    consentimientoObligatorio: '(required)',
    consentimientoOpcional: '(optional)',
    firmaDeclaracion: 'I electronically sign accepting the above and confirming the accuracy of the data.'
  }
};

function getLegalTexts(lang) {
  return TEXTS[lang] || TEXTS.es;
}

module.exports = {
  getLegalTexts,
  RAZON_SOCIAL,
  CIF,
  DOM_SOCIAL,
  DOM_HOTEL,
  CONTACTO,
  REGISTRO
};
