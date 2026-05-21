import { supabase } from "@/lib/supabase";
import { logActivity } from "@/services/activityService";

export interface DocumentData {
  workspace_id: string;
  uploaded_by: string;
  file_name: string;
  file_path: string;
  file_size: number;
  tipo_documento: string;
  estado: "Activo" | "Inactivo" | "Vencido";
  nombre_deudor?: string;
  nombre_codeudor?: string;
  id_deudor?: string;
  id_codeudor?: string;
  fecha_vencimiento?: string;
  valor_titulo?: number;
  proceso?: string;
  subproceso?: string;
  nombre_del_titulo?: string;
  fecha_firma_title?: string;
  fecha_caducidad?: string;
  fecha_construccion?: string;
  tasa_interes?: number;
  plazo_credito?: number;
  ciudad_expedicion?: string;
  moneda?: string;
  lugar_pago?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  ciudad?: string;
  departamento?: string;
  tipo_persona?: string;
  genero?: string;
  estado_civil?: string;
  nivel_educativo?: string;
  ocupacion?: string;
  actividad_economica?: string;
  ingresos_mensuales?: number;
  patrimonio?: number;
  experiencia_crediticia?: string;
  scoring?: number;
  garantia?: string;
  valor_garantia?: number;
  observaciones?: string;
  etapa_cobranza?: string;
  dias_mora?: number;
  valor_mora?: number;
  gestor_asignado?: string;
  fecha_ultima_gestion?: string;
  resultado_ultima_gestion?: string;
  proxima_accion?: string;
  fecha_proxima_accion?: string;
  hash_sha256?: string;
}

export interface CustomAttributeValue {
  documento_id: string;
  atributo_id: string;
  valor: string;
}

/** Calcula el hash SHA-256 de un File y lo retorna como cadena hex. */
async function computeSha256(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    console.error("[documentService] SHA-256 error", e);
    return "";
  }
}

export const documentService = {
  async uploadFile(
    file: File,
    workspaceId: string,
    userId: string,
  ): Promise<{ path: string; hash: string }> {
    const fileExt = file.name.split(".").pop();
    const fileName = `${workspaceId}/${userId}/${Date.now()}.${fileExt}`;

    // Calcular hash SHA-256 antes de subir (Req 5)
    const hash = await computeSha256(file);

    const { data, error } = await supabase.storage
      .from("documents")
      .upload(fileName, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) throw error;

    // Log file upload (storage)
    try {
      await logActivity({
        accion: "Documento subido",
        entidad_tipo: "documento",
        entidad_nombre: file.name,
        entidad_id: null,
        metadata: { path: data.path, hash_sha256: hash },
      } as any);
    } catch (e) {
      console.error("[documentService] logActivity upload error", e);
    }

    return { path: data.path, hash };
  },

  async createDocument(documentData: DocumentData): Promise<any> {
    const { data, error } = await supabase
      .from("documentos")
      .insert(documentData)
      .select()
      .single();

    if (error) throw error;

    // Log document creation
    try {
      await logActivity({
        accion: "Documento creado",
        entidad_tipo: "documento",
        entidad_nombre: documentData.file_name,
        entidad_id: data.id,
      });
    } catch (e) {
      console.error("[documentService] logActivity error", e);
    }

    return data;
  },

  async saveCustomAttributes(
    attributes: CustomAttributeValue[],
  ): Promise<void> {
    if (attributes.length === 0) return;

    const { error } = await supabase
      .from("valores_atributos")
      .insert(attributes);

    if (error) throw error;
  },

  async getDocumentsByWorkspace(workspaceId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from("documentos")
      .select(
        `
        *,
        uploader:uploaded_by(full_name),
        valores_atributos (
          id,
          atributo_id,
          valor,
          atributos_personalizados (
            id,
            nombre,
            tipo
          )
        )
      `,
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return data || [];
  },

  async getDocumentsByWorkspacePaged(
    workspaceId: string,
    start: number,
    end: number,
  ): Promise<{ data: any[]; error: any }> {
    const { data, error } = await supabase
      .from("documentos")
      .select(
        `
        *,
        uploader:uploaded_by(full_name),
        valores_atributos (
          id,
          atributo_id,
          valor,
          atributos_personalizados (
            id,
            nombre,
            tipo
          )
        )
      `,
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(start, end);

    return { data: data || [], error };
  },

  async getDocumentsCount(workspaceId: string): Promise<number> {
    const { count, error } = await supabase
      .from("documentos")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    if (error) throw error;
    return count || 0;
  },

  async downloadDocument(filePath: string): Promise<Blob> {
    // Try to resolve the human-friendly document name from the DB
    let friendlyName = filePath;
    try {
      const { data: docData, error: docErr } = await supabase
        .from("documentos")
        .select("id, file_name")
        .eq("file_path", filePath)
        .limit(1)
        .single();

      if (!docErr && docData && docData.file_name) {
        friendlyName = docData.file_name;
      }
    } catch (e) {
      // ignore lookup errors and fall back to filePath
    }

    const { data, error } = await supabase.storage
      .from("documents")
      .download(filePath);

    if (error) throw error;

    // Log download action using friendly name when available
    try {
      await logActivity({
        accion: "Documento descargado",
        entidad_tipo: "documento",
        entidad_nombre: friendlyName,
        entidad_id: null,
      } as any);
    } catch (e) {
      console.error("[documentService] logActivity download error", e);
    }

    return data;
  },

  async getDocumentUrl(filePath: string): Promise<string> {
    const { data } = supabase.storage.from("documents").getPublicUrl(filePath);

    return data.publicUrl;
  },

  async getSignedUrl(filePath: string, expiresInSeconds: number = 120): Promise<string> {
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(filePath, expiresInSeconds);

    if (error) throw error;

    return (data && (data as any).signedUrl) || "";
  },

  async updateDocument(
    documentId: string,
    updates: Partial<DocumentData>,
  ): Promise<any> {
    const { data, error } = await supabase
      .from("documentos")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .select()
      .single();

    if (error) throw error;

    // Log document modification
    try {
      await logActivity({
        accion: "Documento modificado",
        entidad_tipo: "documento",
        entidad_nombre:
          (data && data.file_name) ||
          (updates && (updates as any).file_name) ||
          null,
        entidad_id: documentId,
        metadata: updates || null,
      } as any);
    } catch (e) {
      console.error("[documentService] logActivity update error", e);
    }

    return data;
  },

  async deleteDocument(documentId: string, filePath: string): Promise<void> {
    // Resolve document name for logging
    let friendlyName = filePath;
    try {
      const { data: docData, error: docErr } = await supabase
        .from("documentos")
        .select("file_name")
        .eq("id", documentId)
        .limit(1)
        .single();

      if (!docErr && docData && docData.file_name) {
        friendlyName = docData.file_name;
      }
    } catch (e) {
      // ignore and fallback to filePath
    }

    const { error: storageError } = await supabase.storage
      .from("documents")
      .remove([filePath]);

    if (storageError) throw storageError;

    const { error: dbError } = await supabase
      .from("documentos")
      .delete()
      .eq("id", documentId);

    if (dbError) throw dbError;

    // Log document deletion using friendly name when available
    try {
      await logActivity({
        accion: "Documento eliminado",
        entidad_tipo: "documento",
        entidad_nombre: friendlyName,
        entidad_id: documentId,
      } as any);
    } catch (e) {
      console.error("[documentService] logActivity delete error", e);
    }
  },

  async archiveDocument(documentId?: string): Promise<void> {
    if (!documentId) return;

    // Resolve document name for logging
    let friendlyName = documentId;
    try {
      const { data: docData } = await supabase
        .from("documentos")
        .select("file_name")
        .eq("id", documentId)
        .single();

      if (docData && docData.file_name) {
        friendlyName = docData.file_name;
      }
    } catch (e) {
      // ignore
    }

    const { error } = await supabase
      .from("documentos")
      .update({ estado: "Archivado" })
      .eq("id", documentId);

    if (error) throw error;

    // Log the archive
    try {
      await logActivity({
        accion: "Documento archivado",
        entidad_tipo: "documento",
        entidad_nombre: friendlyName,
        entidad_id: documentId,
      } as any);
    } catch (e) {
      console.error("[documentService] logActivity archive error", e);
    }
  },

  async getDocumentStats(workspaceId: string): Promise<any> {
    const { data, error } = await supabase
      .from("documentos")
      .select("estado, valor_titulo, fecha_vencimiento")
      .eq("workspace_id", workspaceId);

    if (error) throw error;

    // Derive document status from fecha_vencimiento when applicable so KPIs reflect expiration dates
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    let totalValue = 0;
    let totalDocuments = 0;
    let activeDocuments = 0;
    let inactiveDocuments = 0;
    let expiredDocuments = 0;
    let expiringDocuments = 0;

    for (const d of data) {
      totalDocuments += 1;
      totalValue += d.valor_titulo || 0;

      // Determine expiration-based status
      let isExpired = false;
      let isExpiring = false;

      if (d.fecha_vencimiento) {
        const vencimiento = new Date(d.fecha_vencimiento);
        if (vencimiento < today) {
          isExpired = true;
        } else if (vencimiento <= thirtyDaysFromNow) {
          isExpiring = true;
        }
      }

      if (isExpired) {
        expiredDocuments += 1;
      } else if (isExpiring) {
        expiringDocuments += 1;
      }

      // Count active/inactive considering expiration
      if (!isExpired && d.estado === "Activo") {
        activeDocuments += 1;
      }

      if (d.estado === "Inactivo") {
        inactiveDocuments += 1;
      }
    }

    return {
      totalDocuments,
      activeDocuments,
      inactiveDocuments,
      expiredDocuments,
      expiringDocuments,
      totalValue,
    };
  },
};
