export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      anthropic_usage: {
        Row: {
          cache_creation_input_tokens: number
          cache_read_input_tokens: number
          cost_usd: number
          created_at: string
          feature: string
          id: string
          input_tokens: number
          metadata: Json | null
          model: string
          output_tokens: number
          success: boolean
          web_search_requests: number
        }
        Insert: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          cost_usd?: number
          created_at?: string
          feature: string
          id?: string
          input_tokens?: number
          metadata?: Json | null
          model: string
          output_tokens?: number
          success?: boolean
          web_search_requests?: number
        }
        Update: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          cost_usd?: number
          created_at?: string
          feature?: string
          id?: string
          input_tokens?: number
          metadata?: Json | null
          model?: string
          output_tokens?: number
          success?: boolean
          web_search_requests?: number
        }
        Relationships: []
      }
      brand_follows: {
        Row: {
          company_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_follows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      captured_emails: {
        Row: {
          auth_results: Json | null
          category: string
          classification_confidence: number
          classification_source: string
          company_id: string | null
          content_hash: string | null
          country_confidence: number | null
          country_signals: Json | null
          created_at: string
          currency: string | null
          detected_country: string | null
          discount_amount: number | null
          discount_percent: number | null
          duplicate_of: string | null
          esp_confidence: number | null
          esp_provider: string | null
          esp_signals: Json | null
          group_segment_categories: string[] | null
          has_dark_mode: boolean
          has_gif: boolean
          html_content: string
          html_storage_path: string | null
          id: string
          image_urls: string[]
          inbox_id: string | null
          list_headers: Json | null
          llm_model: string | null
          llm_reasoning: string | null
          metadata: Json
          plain_text: string | null
          preheader: string | null
          primary_cta_text: string | null
          primary_cta_url: string | null
          processed_at: string | null
          promo_code: string | null
          raw_payload: Json
          received_at: string
          recipient_email: string
          remote_image_urls: string[]
          resend_message_id: string | null
          segment_category: string | null
          segment_country: string | null
          sender_email: string
          sent_at: string | null
          subcategory: string | null
          subject: string
        }
        Insert: {
          auth_results?: Json | null
          category?: string
          classification_confidence?: number
          classification_source?: string
          company_id?: string | null
          content_hash?: string | null
          country_confidence?: number | null
          country_signals?: Json | null
          created_at?: string
          currency?: string | null
          detected_country?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          duplicate_of?: string | null
          esp_confidence?: number | null
          esp_provider?: string | null
          esp_signals?: Json | null
          group_segment_categories?: string[] | null
          has_dark_mode?: boolean
          has_gif?: boolean
          html_content: string
          html_storage_path?: string | null
          id?: string
          image_urls?: string[]
          inbox_id?: string | null
          list_headers?: Json | null
          llm_model?: string | null
          llm_reasoning?: string | null
          metadata?: Json
          plain_text?: string | null
          preheader?: string | null
          primary_cta_text?: string | null
          primary_cta_url?: string | null
          processed_at?: string | null
          promo_code?: string | null
          raw_payload?: Json
          received_at?: string
          recipient_email: string
          remote_image_urls?: string[]
          resend_message_id?: string | null
          segment_category?: string | null
          segment_country?: string | null
          sender_email: string
          sent_at?: string | null
          subcategory?: string | null
          subject: string
        }
        Update: {
          auth_results?: Json | null
          category?: string
          classification_confidence?: number
          classification_source?: string
          company_id?: string | null
          content_hash?: string | null
          country_confidence?: number | null
          country_signals?: Json | null
          created_at?: string
          currency?: string | null
          detected_country?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          duplicate_of?: string | null
          esp_confidence?: number | null
          esp_provider?: string | null
          esp_signals?: Json | null
          group_segment_categories?: string[] | null
          has_dark_mode?: boolean
          has_gif?: boolean
          html_content?: string
          html_storage_path?: string | null
          id?: string
          image_urls?: string[]
          inbox_id?: string | null
          list_headers?: Json | null
          llm_model?: string | null
          llm_reasoning?: string | null
          metadata?: Json
          plain_text?: string | null
          preheader?: string | null
          primary_cta_text?: string | null
          primary_cta_url?: string | null
          processed_at?: string | null
          promo_code?: string | null
          raw_payload?: Json
          received_at?: string
          recipient_email?: string
          remote_image_urls?: string[]
          resend_message_id?: string | null
          segment_category?: string | null
          segment_country?: string | null
          sender_email?: string
          sent_at?: string | null
          subcategory?: string | null
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "captured_emails_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_emails_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "captured_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_emails_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "company_inboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_emails: {
        Row: {
          added_at: string
          collection_id: string
          email_id: string
        }
        Insert: {
          added_at?: string
          collection_id: string
          email_id: string
        }
        Update: {
          added_at?: string
          collection_id?: string
          email_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_emails_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_emails_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "captured_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          last_viewed_at: string | null
          name: string
          rules: Json | null
          share_slug: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          last_viewed_at?: string | null
          name: string
          rules?: Json | null
          share_slug: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          last_viewed_at?: string | null
          name?: string
          rules?: Json | null
          share_slug?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          created_at: string
          deleted_at: string | null
          domain: string
          hq_country: string | null
          id: string
          is_curated: boolean
          is_global: boolean
          logo_confidence: number | null
          logo_origin_path: string | null
          logo_source: string | null
          logo_stale: boolean
          logo_storage_path: string | null
          logo_updated_at: string | null
          market_citation: Json | null
          market_confidence: number | null
          market_resolved_at: string | null
          market_source: string | null
          markets: string[]
          name: string
          primary_market_country: string | null
          subscribed_since: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          domain: string
          hq_country?: string | null
          id?: string
          is_curated?: boolean
          is_global?: boolean
          logo_confidence?: number | null
          logo_origin_path?: string | null
          logo_source?: string | null
          logo_stale?: boolean
          logo_storage_path?: string | null
          logo_updated_at?: string | null
          market_citation?: Json | null
          market_confidence?: number | null
          market_resolved_at?: string | null
          market_source?: string | null
          markets?: string[]
          name: string
          primary_market_country?: string | null
          subscribed_since?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          domain?: string
          hq_country?: string | null
          id?: string
          is_curated?: boolean
          is_global?: boolean
          logo_confidence?: number | null
          logo_origin_path?: string | null
          logo_source?: string | null
          logo_stale?: boolean
          logo_storage_path?: string | null
          logo_updated_at?: string | null
          market_citation?: Json | null
          market_confidence?: number | null
          market_resolved_at?: string | null
          market_source?: string | null
          markets?: string[]
          name?: string
          primary_market_country?: string | null
          subscribed_since?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_inboxes: {
        Row: {
          company_id: string
          created_at: string
          email_address: string
          id: string
          is_primary: boolean
          segment_category: string | null
          segment_country: string | null
          segment_label: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          email_address: string
          id?: string
          is_primary?: boolean
          segment_category?: string | null
          segment_country?: string | null
          segment_label?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          email_address?: string
          id?: string
          is_primary?: boolean
          segment_category?: string | null
          segment_country?: string | null
          segment_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_inboxes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_set_members: {
        Row: {
          added_at: string
          company_id: string
          set_id: string
        }
        Insert: {
          added_at?: string
          company_id: string
          set_id: string
        }
        Update: {
          added_at?: string
          company_id?: string
          set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_set_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_set_members_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "competitor_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_sets: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_products: {
        Row: {
          bbox: Json | null
          currency: string | null
          discount_percent: number | null
          email_id: string
          extracted_at: string
          id: string
          image_storage_path: string | null
          name: string | null
          price: number | null
          source_url: string | null
        }
        Insert: {
          bbox?: Json | null
          currency?: string | null
          discount_percent?: number | null
          email_id: string
          extracted_at?: string
          id?: string
          image_storage_path?: string | null
          name?: string | null
          price?: number | null
          source_url?: string | null
        }
        Update: {
          bbox?: Json | null
          currency?: string | null
          discount_percent?: number | null
          email_id?: string
          extracted_at?: string
          id?: string
          image_storage_path?: string | null
          name?: string | null
          price?: number | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_products_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "captured_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_emails: {
        Row: {
          email_id: string
          id: string
          saved_at: string
          user_id: string
        }
        Insert: {
          email_id: string
          id?: string
          saved_at?: string
          user_id: string
        }
        Update: {
          email_id?: string
          id?: string
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_emails_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "captured_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_skips: {
        Row: {
          created_at: string
          domain: string
          id: string
          market: string | null
          reason: string | null
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          market?: string | null
          reason?: string | null
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          market?: string | null
          reason?: string | null
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          attempt_count: number
          event_type: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          received_at: string
          source: string
          status: string
          svix_id: string | null
        }
        Insert: {
          attempt_count?: number
          event_type: string
          id?: string
          last_error?: string | null
          payload: Json
          processed_at?: string | null
          received_at?: string
          source?: string
          status?: string
          svix_id?: string | null
        }
        Update: {
          attempt_count?: number
          event_type?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
          source?: string
          status?: string
          svix_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      company_email_stats: {
        Row: {
          company_id: string | null
          email_count: number | null
          last_received_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "captured_emails_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      captured_email_content_hash: {
        Args: { p_plain_text: string; p_subject: string }
        Returns: string
      }
      captured_email_group_segments: {
        Args: { p_canonical: string }
        Returns: string[]
      }
      claim_webhook_events: {
        Args: { batch_limit?: number }
        Returns: {
          attempt_count: number
          event_type: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          received_at: string
          source: string
          status: string
          svix_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "webhook_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      pirol_admin_dashboard_stats: { Args: never; Returns: Json }
      pirol_admin_growth_series: { Args: never; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
