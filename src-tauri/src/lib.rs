use serde_json::{json, Value};
use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Emitter, LogicalSize, Manager, Size, WindowEvent,
};

const DATA_ENDPOINT: &str = "https://script.google.com/macros/s/AKfycbwPihtIvUQujuvtaUctNC2ojUfZMvobMh_iRUh8RNm1OvGL3Z2NCug5bwnEKJAfuOHclw/exec";

#[tauri::command]
async fn fetch_dashboard_data(token: String) -> Result<Value, String> {
  if token.trim().is_empty() {
    return Err("Код доступа не указан".into());
  }

  let response = reqwest::Client::new()
    .post(DATA_ENDPOINT)
    .json(&json!({ "token": token }))
    .send()
    .await
    .map_err(|error| format!("Не удалось подключиться к данным: {error}"))?;

  if !response.status().is_success() {
    return Err(format!("Сервис данных ответил с ошибкой {}", response.status()));
  }

  response
    .json::<Value>()
    .await
    .map_err(|error| format!("Сервис данных вернул неверный ответ: {error}"))
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
  Ok(next)
}

fn show_widget(app: &AppHandle) {
  let _ = collapse_widget_window(app.clone());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_autostart::Builder::new().app_name("GARMENT BURO").build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![
      fetch_dashboard_data,
      open_dashboard_window,
      collapse_widget_window,
      hide_main_window,
      toggle_always_on_top
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

      TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("application icon").clone())
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
