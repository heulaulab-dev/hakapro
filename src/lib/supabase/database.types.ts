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
      alert_events: {
        Row: {
          alert_id: string
          id: string
          observed_as_of: string
          observed_value: number
          read_at: string | null
          triggered_at: string
        }
        Insert: {
          alert_id: string
          id?: string
          observed_as_of: string
          observed_value: number
          read_at?: string | null
          triggered_at?: string
        }
        Update: {
          alert_id?: string
          id?: string
          observed_as_of?: string
          observed_value?: number
          read_at?: string | null
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_events_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          last_triggered_at: string | null
          metric: string
          operator: string
          symbol: string
          threshold: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_triggered_at?: string | null
          metric: string
          operator: string
          symbol: string
          threshold: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_triggered_at?: string | null
          metric?: string
          operator?: string
          symbol?: string
          threshold?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          commissioners: Json | null
          data_as_of: string | null
          description: string | null
          directors: Json | null
          source: string
          subsidiaries: Json | null
          symbol: string
          updated_at: string
          website: string | null
        }
        Insert: {
          commissioners?: Json | null
          data_as_of?: string | null
          description?: string | null
          directors?: Json | null
          source: string
          subsidiaries?: Json | null
          symbol: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          commissioners?: Json | null
          data_as_of?: string | null
          description?: string | null
          directors?: Json | null
          source?: string
          subsidiaries?: Json | null
          symbol?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: true
            referencedRelation: "securities"
            referencedColumns: ["symbol"]
          },
        ]
      }
      company_fundamentals: {
        Row: {
          id: string
          metrics: Json
          period_date: string
          period_type: string
          source: string
          symbol: string
          updated_at: string
        }
        Insert: {
          id?: string
          metrics: Json
          period_date: string
          period_type: string
          source: string
          symbol: string
          updated_at?: string
        }
        Update: {
          id?: string
          metrics?: Json
          period_date?: string
          period_type?: string
          source?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_fundamentals_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "securities"
            referencedColumns: ["symbol"]
          },
        ]
      }
      corporate_actions: {
        Row: {
          action_type: string
          description: string | null
          document_url: string | null
          event_date: string
          id: string
          source: string
          symbol: string
          updated_at: string
        }
        Insert: {
          action_type: string
          description?: string | null
          document_url?: string | null
          event_date: string
          id?: string
          source: string
          symbol: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          description?: string | null
          document_url?: string | null
          event_date?: string
          id?: string
          source?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "corporate_actions_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "securities"
            referencedColumns: ["symbol"]
          },
        ]
      }
      market_indices: {
        Row: {
          code: string
          name: string
          source: string
          updated_at: string
        }
        Insert: {
          code: string
          name: string
          source: string
          updated_at?: string
        }
        Update: {
          code?: string
          name?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      market_snapshots: {
        Row: {
          as_of: string
          change_percent: number | null
          close: number | null
          code: string
          id: string
          source: string
          value: number | null
          volume: number | null
        }
        Insert: {
          as_of: string
          change_percent?: number | null
          close?: number | null
          code: string
          id?: string
          source: string
          value?: number | null
          volume?: number | null
        }
        Update: {
          as_of?: string
          change_percent?: number | null
          close?: number | null
          code?: string
          id?: string
          source?: string
          value?: number | null
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "market_snapshots_code_fkey"
            columns: ["code"]
            isOneToOne: false
            referencedRelation: "market_indices"
            referencedColumns: ["code"]
          },
        ]
      }
      notes: {
        Row: {
          body: string
          created_at: string
          id: string
          symbol: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          symbol?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          symbol?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          message: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message: string
          read_at?: string | null
          title: string
          type: string
          user_id?: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      ownership_snapshots: {
        Row: {
          holder_name: string
          id: string
          percentage: number | null
          shares: number | null
          snapshot_date: string
          source: string
          symbol: string
          updated_at: string
        }
        Insert: {
          holder_name: string
          id?: string
          percentage?: number | null
          shares?: number | null
          snapshot_date: string
          source: string
          symbol: string
          updated_at?: string
        }
        Update: {
          holder_name?: string
          id?: string
          percentage?: number | null
          shares?: number | null
          snapshot_date?: string
          source?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ownership_snapshots_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "securities"
            referencedColumns: ["symbol"]
          },
        ]
      }
      portfolio_transactions: {
        Row: {
          cash_amount: number | null
          created_at: string
          fees: number
          id: string
          notes: string | null
          portfolio_id: string
          price: number | null
          quantity: number | null
          symbol: string | null
          transaction_date: string
          transaction_type: string
          updated_at: string
        }
        Insert: {
          cash_amount?: number | null
          created_at?: string
          fees?: number
          id?: string
          notes?: string | null
          portfolio_id: string
          price?: number | null
          quantity?: number | null
          symbol?: string | null
          transaction_date: string
          transaction_type: string
          updated_at?: string
        }
        Update: {
          cash_amount?: number | null
          created_at?: string
          fees?: number
          id?: string
          notes?: string | null
          portfolio_id?: string
          price?: number | null
          quantity?: number | null
          symbol?: string | null
          transaction_date?: string
          transaction_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_transactions_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolios: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      saved_screeners: {
        Row: {
          conditions: Json
          created_at: string
          id: string
          name: string
          sort_config: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          conditions?: Json
          created_at?: string
          id?: string
          name: string
          sort_config?: Json
          updated_at?: string
          user_id?: string
        }
        Update: {
          conditions?: Json
          created_at?: string
          id?: string
          name?: string
          sort_config?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      securities: {
        Row: {
          board: string | null
          company_name: string
          exchange: string
          listing_date: string | null
          sector: string | null
          status: string
          subsector: string | null
          symbol: string
          updated_at: string
        }
        Insert: {
          board?: string | null
          company_name: string
          exchange?: string
          listing_date?: string | null
          sector?: string | null
          status?: string
          subsector?: string | null
          symbol: string
          updated_at?: string
        }
        Update: {
          board?: string | null
          company_name?: string
          exchange?: string
          listing_date?: string | null
          sector?: string | null
          status?: string
          subsector?: string | null
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          columns: Json
          density: string
          shortcuts: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          columns?: Json
          density?: string
          shortcuts?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          columns?: Json
          density?: string
          shortcuts?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      watchlist_items: {
        Row: {
          created_at: string
          id: string
          position: number
          symbol: string
          watchlist_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          symbol: string
          watchlist_id: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          symbol?: string
          watchlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_items_watchlist_id_fkey"
            columns: ["watchlist_id"]
            isOneToOne: false
            referencedRelation: "watchlists"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlists: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workspace_panels: {
        Row: {
          created_at: string
          id: string
          is_locked: boolean
          panel_type: string
          position: number
          settings: Json
          symbol: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_locked?: boolean
          panel_type: string
          position?: number
          settings?: Json
          symbol?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_locked?: boolean
          panel_type?: string
          position?: number
          settings?: Json
          symbol?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_panels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          layout: Json
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          layout?: Json
          name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          layout?: Json
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      save_workspace: {
        Args: { p_layout: Json; p_name: string }
        Returns: string
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
