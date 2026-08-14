use serde::Deserialize;
use serde_json::{json, Value};
use std::{env, path::Path};
use tauri::{
  image::Image,
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Emitter, LogicalSize, Manager, Size, WindowEvent,
};

const DATA_ENDPOINT: &str = "https://script.google.com/macros/s/AKfycbwPihtIvUQujuvtaUctNC2ojUfZMvobMh_iRUh8RNm1OvGL3Z2NCug5bwnEKJAfuOHclw/exec";
const EXECUTION_SHEET_ID: &str = "1LfhEpCwKrWTww8SvTUVrIofX1bJ1QmU0m7gbruZB0Qg";
const MASTER_PROMPT_DOCUMENT_ID: &str = "1_EBiiqM_7c0FxpXbmfZpAg1-POaftWRm26EIvSflwJk";
const WIDGET_BRIEF_DOCUMENT_ID: &str = "1PKxVgMn7NyL0Kn55WPsODdMK8Fu_IibHsnH5Nv3A0u8";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskAssistantRequest {
  task_id: String,
  mode: String,
  message: Option<String>,
  context: Value,
}

#[tauri::command]
async fn fetch_dashboard_data(token: String) -> Result<Value, String> {
  if token.trim().is_empty() {
    return Err("Код доступа не указан".into());
  }

  let client = reqwest::Client::new();
  let response = client
    .post(DATA_ENDPOINT)
    .json(&json!({ "token": token, "action": "dashboard" }))
    .send()
    .await
    .map_err(|error| format!("Не удалось подключиться к данным: {error}"))?;

  if !response.status().is_success() {
    return Err(format!("Сервис данных ответил с ошибкой {}", response.status()));
  }

  let payload = response
    .json::<Value>()
    .await
    .map_err(|error| format!("Сервис данных вернул неверный ответ: {error}"))?;

  Ok(payload)
}

#[tauri::command]
async fn submit_task_command(token: String, request: Value) -> Result<Value, String> {
  if token.trim().is_empty() {
    return Err("Код доступа не указан".into());
  }
  load_local_environment();
  let endpoint = env::var("APPS_SCRIPT_WEB_APP_URL")
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| DATA_ENDPOINT.to_string());
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(90))
    .build()
    .map_err(|error| format!("Не удалось подготовить write-клиент: {error}"))?;
  let response = client
    .post(endpoint)
    .json(&json!({ "token": token, "action": "taskCommand", "request": request }))
    .send()
    .await
    .map_err(|error| format!("Не удалось отправить команду GPT: {error}"))?;
  if !response.status().is_success() {
    return Err(format!("Apps Script вернул ошибку {}", response.status()));
  }
  let payload = response
    .json::<Value>()
    .await
    .map_err(|error| format!("Apps Script вернул неверный ответ: {error}"))?;
  if payload.get("ok").and_then(Value::as_bool) != Some(true) {
    return Err(payload.get("error").and_then(Value::as_str)
      .unwrap_or("GPT не смог зафиксировать команду")
      .to_string());
  }
  let result = payload.get("commandResult")
    .cloned()
    .ok_or_else(|| "Развёрнутый Apps Script пока не поддерживает запись taskCommand.".to_string())?;
  if result.get("syncStatus").and_then(Value::as_str) != Some("SYNCED") {
    return Err(format!(
      "Команда не подтверждена: {}",
      result.get("syncStatus").and_then(Value::as_str).unwrap_or("UNKNOWN")
    ));
  }
  Ok(result)
}

#[tauri::command]
async fn ack_notification(token: String, notification_id: String, recipient_id: String) -> Result<Value, String> {
  if token.trim().is_empty() || notification_id.trim().is_empty() || recipient_id.trim().is_empty() {
    return Err("Не хватает данных для подтверждения уведомления".into());
  }
  load_local_environment();
  let endpoint = env::var("APPS_SCRIPT_WEB_APP_URL")
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| DATA_ENDPOINT.to_string());
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(30))
    .build()
    .map_err(|error| format!("Не удалось подготовить ACK-клиент: {error}"))?;
  let response = client
    .post(endpoint)
    .json(&json!({
      "token": token,
      "action": "notificationAck",
      "request": { "notificationId": notification_id, "recipientId": recipient_id }
    }))
    .send()
    .await
    .map_err(|error| format!("Не удалось подтвердить уведомление: {error}"))?;
  if !response.status().is_success() {
    return Err(format!("Apps Script вернул ошибку {}", response.status()));
  }
  let payload = response.json::<Value>().await
    .map_err(|error| format!("Apps Script вернул неверный ACK-ответ: {error}"))?;
  if payload.get("ok").and_then(Value::as_bool) != Some(true) {
    return Err(payload.get("error").and_then(Value::as_str)
      .unwrap_or("Apps Script не подтвердил уведомление")
      .to_string());
  }
  let ack = payload.get("notificationAck").cloned()
    .ok_or_else(|| "Apps Script не вернул notificationAck".to_string())?;
  if ack.get("syncStatus").and_then(Value::as_str) != Some("SYNCED") {
    return Err("ACK_AT не подтверждён повторным чтением".into());
  }
  Ok(ack)
}

#[tauri::command]
async fn ask_task_assistant(request: TaskAssistantRequest) -> Result<Value, String> {
  load_local_environment();
  validate_assistant_request(&request)?;

  let api_key = env::var("OPENAI_API_KEY")
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .ok_or_else(|| "OPENAI_API_KEY не найден в окружении desktop-приложения или .env.local".to_string())?;
  let model = env::var("OPENAI_MODEL")
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| "gpt-5.6-terra".to_string());
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(60))
    .build()
    .map_err(|error| format!("Не удалось подготовить GPT-клиент: {error}"))?;

  let master_prompt_id = env::var("GOOGLE_MASTER_PROMPT_DOCUMENT_ID")
    .unwrap_or_else(|_| MASTER_PROMPT_DOCUMENT_ID.to_string());
  let sheet_id = env::var("GOOGLE_EXECUTION_SPREADSHEET_ID")
    .unwrap_or_else(|_| EXECUTION_SHEET_ID.to_string());
  let master_prompt = fetch_text(
    &client,
    &format!("https://docs.google.com/document/d/{master_prompt_id}/export?format=txt"),
    "00_MASTER PROMPT — ЛИЧНЫЙ ПРОЕКТ",
  ).await?;

  let mut live_tables = Vec::new();
  for (title, gid) in [
    ("PLAYBOOKS", "1008"),
    ("TASK_UPDATES", "1011"),
    ("EVENTS", "1012"),
    ("ROUTING_ACTIONS", "1013"),
    ("SESSION_HANDOFFS", "1014"),
  ] {
    let url = format!("https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}");
    let csv = fetch_text(&client, &url, title).await?;
    live_tables.push((title, filter_live_table(title, &csv, &request.context, person_name_from_context(&request.context))?));
  }

  let person_name = person_name_from_context(&request.context);
  if person_name.is_empty() {
    return Err("В текущем dashboard-контексте не определён AUTHOR".into());
  }
  let referenced_document = if context_references_widget_brief(&request.context) {
    let document_id = env::var("GOOGLE_WIDGET_BRIEF_DOCUMENT_ID")
      .unwrap_or_else(|_| WIDGET_BRIEF_DOCUMENT_ID.to_string());
    let content = fetch_text(
      &client,
      &format!("https://docs.google.com/document/d/{document_id}/export?format=txt"),
      "WIDGET — VISION & IMPLEMENTATION BRIEF v1",
    ).await?;
    format!("\n\nСвязанный канонический документ:\n### WIDGET — VISION & IMPLEMENTATION BRIEF v1\n{content}")
  } else {
    String::new()
  };
  let request_text = request.message.as_deref().map(str::trim).filter(|value| !value.is_empty())
    .unwrap_or_else(|| default_assistant_request(&request.mode));
  let tables_text = live_tables
    .iter()
    .map(|(title, csv)| format!("### {title}\n{csv}"))
    .collect::<Vec<_>>()
    .join("\n\n");
  let user_input = format!(
    "AUTHOR = {person_name}.\nTASK_ID = {}.\nMODE = {}.\nREQUEST = {}\n\n\
     Текущий нормализованный контекст, только что прочитанный виджетом из Google Sheets:\n{}\n\n\
     Дополнительные live-листы для reconciliation:\n{}{}\n\n\
     Не используй память прошлых чатов. Этот вызов read-only: не утверждай, что данные записаны или изменены.",
    request.task_id,
    request.mode,
    request_text,
    serde_json::to_string_pretty(&request.context).unwrap_or_else(|_| "{}".into()),
    tables_text,
    referenced_document,
  );
  let instructions = format!(
    "{}\n\nRUNTIME CONTRACT ВИДЖЕТА:\n\
     Ты работаешь в режиме read-only. Не создавай факты, не меняй сроки/OWNER/PRIORITY и не говори, что что-либо записано в Google Sheets.\n\
     Отвечай по-русски, коротко и прикладно. Сначала дай вывод, затем ближайший шаг. Для D2/Course явно укажи, что требуется решение Кости.",
    master_prompt.trim_start_matches('\u{feff}')
  );

  let response = client
    .post("https://api.openai.com/v1/responses")
    .bearer_auth(&api_key)
    .json(&json!({
      "model": model,
      "instructions": instructions,
      "input": user_input,
      "max_output_tokens": 900,
      "store": false
    }))
    .send()
    .await
    .map_err(|error| format!("Не удалось подключиться к OpenAI API: {error}"))?;
  let status = response.status();
  let payload = response
    .json::<Value>()
    .await
    .map_err(|error| format!("OpenAI API вернул неверный ответ: {error}"))?;
  if !status.is_success() {
    let message = payload.pointer("/error/message").and_then(Value::as_str)
      .unwrap_or("OpenAI API вернул ошибку");
    return Err(format!("{message} ({status})"));
  }
  let answer = read_openai_output(&payload)
    .ok_or_else(|| "OpenAI API не вернул текст ответа".to_string())?;
  let response_model = payload.get("model").and_then(Value::as_str).unwrap_or(&model);
  let warnings = assistant_warnings(&request.context);

  Ok(json!({
    "answer": answer,
    "model": response_model,
    "reconciledAt": chrono_like_now(),
    "sources": ["00_MASTER PROMPT — ЛИЧНЫЙ ПРОЕКТ", "10_EXECUTION SYSTEM"],
    "warnings": warnings
  }))
}

async fn fetch_text(client: &reqwest::Client, url: &str, title: &str) -> Result<String, String> {
  let response = client
    .get(url)
    .send()
    .await
    .map_err(|error| format!("Не удалось прочитать «{title}»: {error}"))?;
  if !response.status().is_success() {
    return Err(format!("Не удалось прочитать «{title}» ({})", response.status()));
  }
  let text = response.text().await.map_err(|error| format!("Не удалось прочитать «{title}»: {error}"))?;
  if text.trim().is_empty() {
    return Err(format!("Источник «{title}» пуст или недоступен"));
  }
  Ok(text)
}

fn validate_assistant_request(request: &TaskAssistantRequest) -> Result<(), String> {
  if request.task_id.trim().is_empty() {
    return Err("TASK_ID не указан".into());
  }
  if !matches!(request.mode.as_str(), "start" | "blocker" | "ask" | "acceptance") {
    return Err("Неизвестный режим GPT-запроса".into());
  }
  if request.message.as_ref().map_or(false, |message| message.chars().count() > 4_000) {
    return Err("Запрос слишком длинный. Сократите его до 4000 символов.".into());
  }
  Ok(())
}

fn default_assistant_request(mode: &str) -> &'static str {
  match mode {
    "start" => "Дай понятный вектор старта и один ближайший конкретный шаг.",
    "blocker" => "Помоги снять описанный блокер и продолжить работу.",
    "acceptance" => "Проверь готовность результата по acceptance criteria и назови недостающее.",
    _ => "Ответь на вопрос по текущей задаче, опираясь только на актуальный контекст.",
  }
}

fn read_openai_output(payload: &Value) -> Option<String> {
  if let Some(text) = payload.get("output_text").and_then(Value::as_str).filter(|value| !value.trim().is_empty()) {
    return Some(text.trim().to_string());
  }
  let texts = payload.get("output")?.as_array()?.iter()
    .flat_map(|item| item.get("content").and_then(Value::as_array).into_iter().flatten())
    .filter(|item| item.get("type").and_then(Value::as_str) == Some("output_text"))
    .filter_map(|item| item.get("text").and_then(Value::as_str))
    .collect::<Vec<_>>();
  if texts.is_empty() { None } else { Some(texts.join("\n").trim().to_string()) }
}

fn assistant_warnings(context: &Value) -> Vec<&'static str> {
  let mut warnings = Vec::new();
  if context.pointer("/dataHealth/usingSnapshot").and_then(Value::as_bool) == Some(true) {
    warnings.push("Используется последний сохранённый снимок, а не live-данные.");
  }
  if context.pointer("/dataHealth/codes").and_then(Value::as_array)
    .map_or(false, |codes| codes.iter().any(|code| code.as_str() == Some("DATA_GAP"))) {
    warnings.push("В текущих данных есть DATA_GAP.");
  }
  warnings
}

fn filter_live_table(
  title: &str,
  input: &str,
  context: &Value,
  person_name: &str,
) -> Result<String, String> {
  let task_ids = relevant_task_ids(context);
  let playbook_ids = referenced_playbook_ids(context);
  let mut reader = csv::ReaderBuilder::new()
    .flexible(true)
    .from_reader(input.as_bytes());
  let headers = reader.headers()
    .map_err(|error| format!("Не удалось прочитать заголовки {title}: {error}"))?
    .clone();
  let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
  writer.write_record(&headers)
    .map_err(|error| format!("Не удалось подготовить контекст {title}: {error}"))?;

  for record in reader.records() {
    let record = record.map_err(|error| format!("Не удалось прочитать строку {title}: {error}"))?;
    let keep = match title {
      "PLAYBOOKS" => {
        let id = csv_value(&headers, &record, "PLAYBOOK_ID");
        id == "PB-002" || playbook_ids.iter().any(|item| item == id)
      }
      "TASK_UPDATES" => {
        task_ids.iter().any(|id| id == csv_value(&headers, &record, "TASK_ID"))
          || csv_value(&headers, &record, "AUTHOR") == person_name
      }
      "EVENTS" => {
        contains_case_insensitive(csv_value(&headers, &record, "PARTICIPANTS"), person_name)
          || task_ids.iter().any(|id| csv_value(&headers, &record, "RELATED_TASKS").contains(id))
      }
      "ROUTING_ACTIONS" => {
        csv_value(&headers, &record, "ACTOR") == person_name
          || task_ids.iter().any(|id| id == csv_value(&headers, &record, "TASK_ID"))
      }
      "SESSION_HANDOFFS" => csv_value(&headers, &record, "AUTHOR").to_lowercase() == person_name.to_lowercase(),
      _ => false,
    };
    if keep {
      writer.write_record(&record)
        .map_err(|error| format!("Не удалось подготовить контекст {title}: {error}"))?;
    }
  }

  let bytes = writer.into_inner()
    .map_err(|error| format!("Не удалось завершить контекст {title}: {error}"))?;
  String::from_utf8(bytes).map_err(|error| format!("Контекст {title} имеет неверную кодировку: {error}"))
}

fn csv_value<'a>(headers: &csv::StringRecord, record: &'a csv::StringRecord, name: &str) -> &'a str {
  headers.iter().position(|header| header.trim_start_matches('\u{feff}') == name)
    .and_then(|index| record.get(index))
    .unwrap_or("")
    .trim()
}

fn relevant_task_ids(context: &Value) -> Vec<String> {
  let mut ids = Vec::new();
  if let Some(id) = context.pointer("/task/id").and_then(Value::as_str) {
    ids.push(id.to_string());
  }
  if let Some(tasks) = context.get("relatedTasks").and_then(Value::as_array) {
    ids.extend(tasks.iter().filter_map(|task| task.get("id").and_then(Value::as_str)).map(str::to_string));
  }
  ids.sort();
  ids.dedup();
  ids
}

fn referenced_playbook_ids(context: &Value) -> Vec<String> {
  context.pointer("/taskContext/canonicalRefs")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .filter_map(Value::as_str)
    .flat_map(|reference| reference.split(|character: char| character == ';' || character == ',' || character.is_whitespace()))
    .filter(|part| part.starts_with("PB-") && part[3..].chars().all(|character| character.is_ascii_digit()))
    .map(str::to_string)
    .collect()
}

fn context_references_widget_brief(context: &Value) -> bool {
  context.pointer("/taskContext/canonicalRefs")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .filter_map(Value::as_str)
    .any(|reference| reference.to_lowercase().contains("widget brief") || reference.contains("WIDGET — VISION"))
}

fn person_name_from_context(context: &Value) -> &str {
  context.get("personName").and_then(Value::as_str).unwrap_or("").trim()
}

fn contains_case_insensitive(value: &str, needle: &str) -> bool {
  value.to_lowercase().contains(&needle.to_lowercase())
}

fn load_local_environment() {
  for candidate in [Path::new(".env.local"), Path::new("../.env.local")] {
    if candidate.exists() {
      let _ = dotenvy::from_path(candidate);
      break;
    }
  }
}

fn chrono_like_now() -> String {
  chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
fn open_dashboard_window(app: AppHandle) -> Result<(), String> {
  set_main_view(&app, "dashboard", 1440.0, 900.0, true)
}

#[tauri::command]
fn collapse_widget_window(app: AppHandle) -> Result<(), String> {
  set_main_view(&app, "widget", 540.0, 280.0, false)
}

#[tauri::command]
fn hide_main_window(app: AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "Окно виджета не найдено".to_string())?;
  window.hide().map_err(|error| error.to_string())
}

fn set_main_view(
  app: &AppHandle,
  view: &str,
  width: f64,
  height: f64,
  decorated: bool,
) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "Окно виджета не найдено".to_string())?;
  window
    .set_decorations(decorated)
    .map_err(|error| error.to_string())?;
  window
    .set_resizable(decorated)
    .map_err(|error| error.to_string())?;
  window
    .set_size(Size::Logical(LogicalSize::new(width, height)))
    .map_err(|error| error.to_string())?;
  window.center().map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())?;
  window.emit("desktop-view", view).map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_always_on_top(app: AppHandle) -> Result<bool, String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "Окно виджета не найдено".to_string())?;
  let next = !window.is_always_on_top().map_err(|error| error.to_string())?;
  window
    .set_always_on_top(next)
    .map_err(|error| error.to_string())?;
  window
    .emit("always-on-top-changed", next)
    .map_err(|error| error.to_string())?;
  Ok(next)
}

#[tauri::command]
fn get_always_on_top(app: AppHandle) -> Result<bool, String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "Окно виджета не найдено".to_string())?;
  window.is_always_on_top().map_err(|error| error.to_string())
}

fn show_widget(app: &AppHandle) {
  let _ = collapse_widget_window(app.clone());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_autostart::Builder::new().app_name("GARMENT BURO").build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![
      fetch_dashboard_data,
      ask_task_assistant,
      submit_task_command,
      ack_notification,
      open_dashboard_window,
      collapse_widget_window,
      hide_main_window,
      toggle_always_on_top,
      get_always_on_top
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let show_item = MenuItem::with_id(app, "show", "Показать виджет", true, None::<&str>)?;
      let dashboard_item = MenuItem::with_id(app, "dashboard", "Открыть дэшборд", true, None::<&str>)?;
      let pin_item = MenuItem::with_id(app, "pin", "Поверх остальных окон", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show_item, &dashboard_item, &pin_item, &quit_item])?;

      let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
      TrayIconBuilder::new()
        .icon(tray_icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "show" => show_widget(app),
          "dashboard" => {
            let _ = open_dashboard_window(app.clone());
          }
          "pin" => {
            let _ = toggle_always_on_top(app.clone());
          }
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            show_widget(tray.app_handle());
          }
        })
        .build(app)?;

      if let Some(window) = app.get_webview_window("main") {
        let window_to_hide = window.clone();
        window.on_window_event(move |event| {
          if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_to_hide.hide();
          }
        });
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running GARMENT BURO desktop application");
}
