--
-- PostgreSQL database dump
--

\restrict u76QBIyUiLmKzYt8wMDhn3cUCWDgE1S3xcr7CwfU8DJRx88A3XSu7XdyQn5pFoN

-- Dumped from database version 15.18 (Debian 15.18-0+deb12u1)
-- Dumped by pg_dump version 15.18 (Debian 15.18-0+deb12u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'SQL_ASCII';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: departamento; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.departamento (
    id integer NOT NULL,
    property_id character varying(30) NOT NULL,
    nombre character varying(100) NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.departamento OWNER TO postgres;

--
-- Name: departamento_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.departamento_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.departamento_id_seq OWNER TO postgres;

--
-- Name: departamento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.departamento_id_seq OWNED BY public.departamento.id;


--
-- Name: documento_empleado; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.documento_empleado (
    id integer NOT NULL,
    empleado_id integer NOT NULL,
    tipo character varying(20) DEFAULT 'otro'::character varying NOT NULL,
    nombre_fichero character varying(255) NOT NULL,
    ruta character varying(500) NOT NULL,
    subido_en timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.documento_empleado OWNER TO postgres;

--
-- Name: documento_empleado_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.documento_empleado_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.documento_empleado_id_seq OWNER TO postgres;

--
-- Name: documento_empleado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.documento_empleado_id_seq OWNED BY public.documento_empleado.id;


--
-- Name: empleado; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.empleado (
    id integer NOT NULL,
    property_id character varying(30) NOT NULL,
    nombre character varying(100) NOT NULL,
    apellidos character varying(150) NOT NULL,
    dni_nie character varying(20),
    fecha_nacimiento date,
    telefono character varying(30),
    email character varying(150),
    puesto character varying(100),
    departamento_id integer,
    fecha_alta date NOT NULL,
    fecha_baja date,
    activo boolean DEFAULT true NOT NULL,
    notas text,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    actualizado_en timestamp without time zone DEFAULT now() NOT NULL,
    pin_hash character varying(100),
    pin_lookup character varying(64),
    qr_token character varying(64),
    coste_hora numeric(8,2),
    CONSTRAINT empleado_coste_hora_chk CHECK (((coste_hora IS NULL) OR (coste_hora >= (0)::numeric)))
);


ALTER TABLE public.empleado OWNER TO postgres;

--
-- Name: empleado_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.empleado_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.empleado_id_seq OWNER TO postgres;

--
-- Name: empleado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.empleado_id_seq OWNED BY public.empleado.id;


--
-- Name: export_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.export_log (
    id integer NOT NULL,
    property_id character varying(30) NOT NULL,
    generado_por character varying(100) NOT NULL,
    empleado_id integer,
    desde date NOT NULL,
    hasta date NOT NULL,
    formato character varying(20) NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    hash character varying(64) NOT NULL,
    CONSTRAINT export_log_formato_chk CHECK (((formato)::text = ANY ((ARRAY['pdf'::character varying, 'csv'::character varying, 'informe_pdf'::character varying, 'informe_csv'::character varying])::text[])))
);


ALTER TABLE public.export_log OWNER TO postgres;

--
-- Name: export_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.export_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.export_log_id_seq OWNER TO postgres;

--
-- Name: export_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.export_log_id_seq OWNED BY public.export_log.id;


--
-- Name: fichaje; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fichaje (
    id integer NOT NULL,
    property_id character varying(30) NOT NULL,
    empleado_id integer NOT NULL,
    tipo character varying(20) NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    origen character varying(20) DEFAULT 'quiosco'::character varying NOT NULL,
    nota text,
    creado_por character varying(100),
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fichaje_origen_chk CHECK (((origen)::text = ANY ((ARRAY['quiosco'::character varying, 'manual'::character varying, 'qr'::character varying])::text[]))),
    CONSTRAINT fichaje_tipo_chk CHECK (((tipo)::text = ANY ((ARRAY['entrada'::character varying, 'salida'::character varying, 'pausa_inicio'::character varying, 'pausa_fin'::character varying])::text[])))
);


ALTER TABLE public.fichaje OWNER TO postgres;

--
-- Name: fichaje_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fichaje_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.fichaje_id_seq OWNER TO postgres;

--
-- Name: fichaje_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fichaje_id_seq OWNED BY public.fichaje.id;


--
-- Name: propiedad; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.propiedad (
    id character varying(30) NOT NULL,
    nombre character varying(200) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.propiedad OWNER TO postgres;

--
-- Name: departamento id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departamento ALTER COLUMN id SET DEFAULT nextval('public.departamento_id_seq'::regclass);


--
-- Name: documento_empleado id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.documento_empleado ALTER COLUMN id SET DEFAULT nextval('public.documento_empleado_id_seq'::regclass);


--
-- Name: empleado id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.empleado ALTER COLUMN id SET DEFAULT nextval('public.empleado_id_seq'::regclass);


--
-- Name: export_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.export_log ALTER COLUMN id SET DEFAULT nextval('public.export_log_id_seq'::regclass);


--
-- Name: fichaje id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fichaje ALTER COLUMN id SET DEFAULT nextval('public.fichaje_id_seq'::regclass);


--
-- Data for Name: departamento; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.departamento (id, property_id, nombre, creado_en) FROM stdin;
1	vera	Recepción	2026-08-11 12:44:57.219062
2	vera	Pisos	2026-08-11 12:44:57.219062
3	vera	Mantenimiento	2026-08-11 12:44:57.219062
\.


--
-- Data for Name: documento_empleado; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.documento_empleado (id, empleado_id, tipo, nombre_fichero, ruta, subido_en) FROM stdin;
\.


--
-- Data for Name: empleado; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.empleado (id, property_id, nombre, apellidos, dni_nie, fecha_nacimiento, telefono, email, puesto, departamento_id, fecha_alta, fecha_baja, activo, notas, creado_en, actualizado_en, pin_hash, pin_lookup, qr_token, coste_hora) FROM stdin;
\.


--
-- Data for Name: export_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.export_log (id, property_id, generado_por, empleado_id, desde, hasta, formato, ts, hash) FROM stdin;
\.


--
-- Data for Name: fichaje; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.fichaje (id, property_id, empleado_id, tipo, ts, origen, nota, creado_por, creado_en) FROM stdin;
\.


--
-- Data for Name: propiedad; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.propiedad (id, nombre, activo, creado_en) FROM stdin;
vera	Hotel Adaria Vera	t	2026-08-11 12:44:57.210802
\.


--
-- Name: departamento_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.departamento_id_seq', 18, true);


--
-- Name: documento_empleado_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.documento_empleado_id_seq', 1, true);


--
-- Name: empleado_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.empleado_id_seq', 5, true);


--
-- Name: export_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.export_log_id_seq', 5, true);


--
-- Name: fichaje_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.fichaje_id_seq', 40, true);


--
-- Name: departamento departamento_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departamento
    ADD CONSTRAINT departamento_pkey PRIMARY KEY (id);


--
-- Name: departamento departamento_property_id_nombre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departamento
    ADD CONSTRAINT departamento_property_id_nombre_key UNIQUE (property_id, nombre);


--
-- Name: documento_empleado documento_empleado_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.documento_empleado
    ADD CONSTRAINT documento_empleado_pkey PRIMARY KEY (id);


--
-- Name: empleado empleado_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.empleado
    ADD CONSTRAINT empleado_pkey PRIMARY KEY (id);


--
-- Name: empleado empleado_property_id_dni_nie_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.empleado
    ADD CONSTRAINT empleado_property_id_dni_nie_key UNIQUE (property_id, dni_nie);


--
-- Name: empleado empleado_property_pin_lookup_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.empleado
    ADD CONSTRAINT empleado_property_pin_lookup_key UNIQUE (property_id, pin_lookup);


--
-- Name: empleado empleado_qr_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.empleado
    ADD CONSTRAINT empleado_qr_token_key UNIQUE (qr_token);


--
-- Name: export_log export_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.export_log
    ADD CONSTRAINT export_log_pkey PRIMARY KEY (id);


--
-- Name: fichaje fichaje_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fichaje
    ADD CONSTRAINT fichaje_pkey PRIMARY KEY (id);


--
-- Name: propiedad propiedad_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.propiedad
    ADD CONSTRAINT propiedad_pkey PRIMARY KEY (id);


--
-- Name: idx_documento_empleado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_documento_empleado ON public.documento_empleado USING btree (empleado_id);


--
-- Name: idx_empleado_activo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_empleado_activo ON public.empleado USING btree (property_id, activo);


--
-- Name: idx_empleado_alta; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_empleado_alta ON public.empleado USING btree (property_id, fecha_alta);


--
-- Name: idx_empleado_departamento; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_empleado_departamento ON public.empleado USING btree (departamento_id);


--
-- Name: idx_empleado_nacimiento; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_empleado_nacimiento ON public.empleado USING btree (property_id, fecha_nacimiento);


--
-- Name: idx_empleado_property; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_empleado_property ON public.empleado USING btree (property_id);


--
-- Name: idx_export_log_property; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_export_log_property ON public.export_log USING btree (property_id, ts);


--
-- Name: idx_fichaje_empleado_ts; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fichaje_empleado_ts ON public.fichaje USING btree (empleado_id, ts);


--
-- Name: idx_fichaje_property_ts; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fichaje_property_ts ON public.fichaje USING btree (property_id, ts);


--
-- Name: departamento departamento_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departamento
    ADD CONSTRAINT departamento_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.propiedad(id);


--
-- Name: documento_empleado documento_empleado_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.documento_empleado
    ADD CONSTRAINT documento_empleado_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleado(id) ON DELETE CASCADE;


--
-- Name: empleado empleado_departamento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.empleado
    ADD CONSTRAINT empleado_departamento_id_fkey FOREIGN KEY (departamento_id) REFERENCES public.departamento(id);


--
-- Name: empleado empleado_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.empleado
    ADD CONSTRAINT empleado_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.propiedad(id);


--
-- Name: export_log export_log_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.export_log
    ADD CONSTRAINT export_log_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleado(id) ON DELETE SET NULL;


--
-- Name: export_log export_log_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.export_log
    ADD CONSTRAINT export_log_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.propiedad(id);


--
-- Name: fichaje fichaje_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fichaje
    ADD CONSTRAINT fichaje_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleado(id) ON DELETE CASCADE;


--
-- Name: fichaje fichaje_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fichaje
    ADD CONSTRAINT fichaje_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.propiedad(id);


--
-- Name: TABLE departamento; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.departamento TO personal_app;


--
-- Name: SEQUENCE departamento_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.departamento_id_seq TO personal_app;


--
-- Name: TABLE documento_empleado; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.documento_empleado TO personal_app;


--
-- Name: SEQUENCE documento_empleado_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.documento_empleado_id_seq TO personal_app;


--
-- Name: TABLE empleado; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.empleado TO personal_app;


--
-- Name: SEQUENCE empleado_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.empleado_id_seq TO personal_app;


--
-- Name: TABLE export_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.export_log TO personal_app;


--
-- Name: SEQUENCE export_log_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.export_log_id_seq TO personal_app;


--
-- Name: TABLE fichaje; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.fichaje TO personal_app;


--
-- Name: SEQUENCE fichaje_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.fichaje_id_seq TO personal_app;


--
-- Name: TABLE propiedad; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.propiedad TO personal_app;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES  TO personal_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES  TO personal_app;


--
-- PostgreSQL database dump complete
--

\unrestrict u76QBIyUiLmKzYt8wMDhn3cUCWDgE1S3xcr7CwfU8DJRx88A3XSu7XdyQn5pFoN

