use alvr_common::{
    once_cell::sync::{Lazy, OnceCell},
    parking_lot::{Condvar, Mutex},
    prelude::*,
};
use alvr_session::{CodecType, MediacodecDataType};
use jni::{objects::GlobalRef, sys::jobject, JavaVM};
use ndk::{
    media::media_codec::{MediaCodec, MediaCodecDirection, MediaCodecOutputResult, MediaFormat},
    native_window::NativeWindow,
};
use ndk_sys as sys;
use std::{
    collections::HashMap,
    ffi::{c_void, CString},
    ptr::NonNull,
    sync::Arc,
    time::Duration,
};

const MODE_PRIVATE: i32 = 0;
const CONFIG_KEY: &str = "config";
const PREF_NAME: &str = "alvr-pref";
const MICROPHONE_PERMISSION: &str = "android.permission.RECORD_AUDIO";

pub static REGISTER_SURFACE_TEXTURE_ON_FRAME_READY: OnceCell<extern "C" fn(*mut c_void, i32)> =
    OnceCell::new();

pub fn vm() -> JavaVM {
    unsafe { JavaVM::from_raw(ndk_context::android_context().vm().cast()).unwrap() }
}

pub fn context() -> jobject {
    ndk_context::android_context().context().cast()
}

struct SyncSurfaceContext {
    image_ready: Mutex<bool>,
    condvar: Condvar,
}

static SYNC_SURFACE_CONTEXTS: Lazy<Mutex<HashMap<i32, Arc<SyncSurfaceContext>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// id: identifier for the SurfaceTexture instance
#[no_mangle]
pub extern "C" fn alvr_surface_texture_frame_available(id: i32) {
    let context = SYNC_SURFACE_CONTEXTS.lock().get(&id).unwrap().clone();

    let mut image_ready_ref = context.image_ready.lock();
    *image_ready_ref = true;

    // note: the lock is still held here
    context.condvar.notify_one();
}

// ASurfaceTexture is avaliable only on API level 28. Use a custom Java wrapper instead.
struct SyncSurface {
    surface_texture: GlobalRef,
    surface: GlobalRef,
    context: Arc<SyncSurfaceContext>,
}

impl SyncSurface {
    fn new(gl_texture: i32) -> Self {
        let vm = vm();
        let env = vm.attach_current_thread().unwrap();

        let surface_texture = env
            .new_object(
                "android/graphics/SurfaceTexture",
                "(I)V",
                &[gl_texture.into()],
            )
            .unwrap();
        let surface_texture = env.new_global_ref(surface_texture).unwrap();

        let id = {
            static ID: Lazy<Mutex<i32>> = Lazy::new(|| Mutex::new(0));
            let mut id_ref = ID.lock();
            *id_ref += 1;
            *id_ref
        };

        let context = Arc::new(SyncSurfaceContext {
            image_ready: Mutex::new(false),
            condvar: Condvar::new(),
        });

        SYNC_SURFACE_CONTEXTS.lock().insert(id, context.clone());

        (REGISTER_SURFACE_TEXTURE_ON_FRAME_READY.get().unwrap())(
            surface_texture.as_obj().cast(),
            id,
        );

        let surface = env
            .new_object(
                "android/view/Surface",
                "(Landroid/graphics/SurfaceTexture;)V",
                &[surface_texture.as_obj().into()],
            )
            .unwrap();
        let surface = env.new_global_ref(surface).unwrap();

        SyncSurface {
            surface_texture,
            surface,
            context,
        }
    }

    fn native_window(&self) -> NativeWindow {
        let vm = vm();
        let env = vm.attach_current_thread().unwrap();

        unsafe {
            NativeWindow::from_surface(env.get_native_interface(), *self.surface.as_obj()).unwrap()
        }
    }

    // Write image data to the texture passed to the constructor. Returns false if timeout.
    fn wait_next_image(&self, timeout: Duration) -> bool {
        let vm = vm();
        let env = vm.attach_current_thread().unwrap();

        let mut image_ready_ref = self.context.image_ready.lock();

        // Note: parking_lot::Condvar has no spurious wakeups
        let has_timeout = self
            .context
            .condvar
            .wait_for(&mut image_ready_ref, timeout)
            .timed_out();

        // always call this even in case of timeout
        env.call_method(&self.surface_texture, "updateTexImage", "()V", &[])
            .unwrap();

        *image_ready_ref = false;

        !has_timeout
    }
}

pub fn try_get_microphone_permission() {
    let vm = vm();
    let env = vm.attach_current_thread().unwrap();

    let mic_perm_jstring = env.new_string(MICROPHONE_PERMISSION).unwrap();

    let permission_status = env
        .call_method(
            context(),
            "checkSelfPermission",
            "(Ljava/lang/String;)I",
            &[mic_perm_jstring.into()],
        )
        .unwrap()
        .i()
        .unwrap();

    if permission_status != 0 {
        let string_class = env.find_class("java/lang/String").unwrap();
        let perm_array = env
            .new_object_array(1, string_class, mic_perm_jstring)
            .unwrap();

        env.call_method(
            context(),
            "requestPermissions",
            "([Ljava/lang/String;I)V",
            &[perm_array.into(), 0.into()],
        )
        .unwrap();

        // todo: handle case where permission is rejected
    }
}

pub fn load_asset(fname: &str) -> Vec<u8> {
    let vm = vm();
    let env = vm.attach_current_thread().unwrap();

    let asset_manager = unsafe {
        let jasset_manager = env
            .call_method(
                context(),
                "getAssets",
                "()Landroid/content/res/AssetManager;",
                &[],
            )
            .unwrap()
            .l()
            .unwrap();
        let asset_manager_ptr =
            sys::AAssetManager_fromJava(env.get_native_interface(), jasset_manager.cast());

        ndk::asset::AssetManager::from_ptr(NonNull::new(asset_manager_ptr).unwrap())
    };

    let fname_cstring = CString::new(fname).unwrap();
    let mut asset = asset_manager.open(fname_cstring.as_c_str()).unwrap();
    asset.get_buffer().unwrap().to_vec()
}

pub fn load_config_string() -> String {
    let vm = vm();
    let env = vm.attach_current_thread().unwrap();

    let pref_name = env.new_string(PREF_NAME).unwrap();
    let shared_preferences = env
        .call_method(
            context(),
            "getSharedPreferences",
            "(Ljava/lang/String;I)Landroid/content/SharedPreferences;",
            &[pref_name.into(), MODE_PRIVATE.into()],
        )
        .unwrap()
        .l()
        .unwrap();

    let key = env.new_string(CONFIG_KEY).unwrap();
    let default = env.new_string("").unwrap();

    let config = env
        .call_method(
            shared_preferences,
            "getString",
            "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
            &[key.into(), default.into()],
        )
        .unwrap();

    env.get_string(config.l().unwrap().into()).unwrap().into()
}

pub fn store_config_string(config: String) {
    let vm = vm();
    let env = vm.attach_current_thread().unwrap();

    let pref_name = env.new_string(PREF_NAME).unwrap();
    let shared_preferences = env
        .call_method(
            context(),
            "getSharedPreferences",
            "(Ljava/lang/String;I)Landroid/content/SharedPreferences;",
            &[pref_name.into(), MODE_PRIVATE.into()],
        )
        .unwrap()
        .l()
        .unwrap();

    let editor = env
        .call_method(
            shared_preferences,
            "edit",
            "()Landroid/content/SharedPreferences$Editor;",
            &[],
        )
        .unwrap()
        .l()
        .unwrap();

    let key = env.new_string(CONFIG_KEY).unwrap();
    let value = env.new_string(config).unwrap();
    env.call_method(
        editor,
        "putString",
        "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/SharedPreferences$Editor;",
        &[key.into(), value.into()],
    )
    .unwrap();

    env.call_method(editor, "apply", "()V", &[]).unwrap();
}

pub fn device_name() -> String {
    let vm = vm();
    let env = vm.attach_current_thread().unwrap();

    let jbrand_name = env
        .get_static_field("android/os/Build", "BRAND", "Ljava/lang/String;")
        .unwrap()
        .l()
        .unwrap();
    let brand_name_raw = env.get_string(jbrand_name.into()).unwrap();
    let brand_name = brand_name_raw.to_string_lossy().as_ref().to_owned();
    // Capitalize first letter
    let mut brand_name_it = brand_name.chars();
    let brand_name = brand_name_it
        .next()
        .unwrap()
        .to_uppercase()
        .chain(brand_name_it)
        .collect::<String>();

    let jdevice_name = env
        .get_static_field("android/os/Build", "MODEL", "Ljava/lang/String;")
        .unwrap()
        .l()
        .unwrap();
    let device_name_raw = env.get_string(jdevice_name.into()).unwrap();
    let device_name = device_name_raw.to_string_lossy().as_ref().to_owned();

    format!("{brand_name} {device_name}")
}

pub struct VideoDecoderEnqueuer {
    inner: Arc<MediaCodec>,
}

unsafe impl Send for VideoDecoderEnqueuer {}

impl VideoDecoderEnqueuer {
    // Block until the buffer has been written or timeout is reached. Returns false if timeout.
    pub fn push_frame_nal(
        &self,
        timestamp: Duration,
        data: &[u8],
        timeout: Duration,
    ) -> StrResult<bool> {
        if let Some(mut buffer) = self.inner.dequeue_input_buffer(timeout).map_err(err!())? {
            buffer.buffer_mut()[..data.len()].copy_from_slice(data);

            // NB: the function expects the timestamp in micros, but nanos is used to have complete
            // precision, so when converted back to Duration it can compare correctly to other
            // Durations
            self.inner
                .queue_input_buffer(buffer, 0, data.len(), timestamp.as_nanos() as _, 0)
                .map_err(err!())?;

            Ok(true)
        } else {
            Ok(false)
        }
    }
}

pub struct VideoDecoderDequeuer {
    inner: Arc<MediaCodec>,
    surface: SyncSurface,
}

unsafe impl Send for VideoDecoderDequeuer {}

impl VideoDecoderDequeuer {
    pub fn dequeue_frame(&self, timeout: Duration) -> StrResult<Option<Duration>> {
        match self.inner.dequeue_output_buffer(timeout).map_err(err!())? {
            MediaCodecOutputResult::BufferDequeued(buffer) => {
                // The buffer timestamp is actually nanoseconds
                // Note: the timestamp is not queried from the SurfceTexture because it's wrong
                let mut timestamp = Duration::from_nanos(buffer.presentation_time_us() as _);

                self.inner
                    .release_output_buffer(buffer, true)
                    .map_err(err!())?;

                if !self.surface.wait_next_image(timeout) {
                    return Ok(None);
                }

                // try polling another frame to keep the latency down
                if let MediaCodecOutputResult::BufferDequeued(buffer) = self
                    .inner
                    .dequeue_output_buffer(Duration::ZERO)
                    .map_err(err!())?
                {
                    timestamp = Duration::from_nanos(buffer.presentation_time_us() as _);

                    self.inner
                        .release_output_buffer(buffer, true)
                        .map_err(err!())?;

                    if !self.surface.wait_next_image(timeout) {
                        return Ok(None);
                    }
                }

                Ok(Some(timestamp))
            }
            event => {
                info!("Dequeue_frame event: {event:?}");
                Ok(None)
            }
        }
    }
}

pub fn video_decoder_split(
    codec_type: CodecType,
    csd_0: &[u8],
    extra_options: &[(String, MediacodecDataType)],
    output_texture: i32, // GLuint
) -> StrResult<(VideoDecoderEnqueuer, VideoDecoderDequeuer)> {
    let surface = SyncSurface::new(output_texture);

    let mime = match codec_type {
        CodecType::H264 => "video/avc",
        CodecType::HEVC => "video/hevc",
    };

    let format = MediaFormat::new();
    format.set_str("mime", mime);
    format.set_i32("width", 512);
    format.set_i32("height", 1024);
    format.set_buffer("csd-0", csd_0);

    for (key, value) in extra_options {
        match value {
            MediacodecDataType::Float(value) => format.set_f32(key, *value),
            MediacodecDataType::Int32(value) => format.set_i32(key, *value),
            MediacodecDataType::Int64(value) => format.set_i64(key, *value),
            MediacodecDataType::String(value) => format.set_str(key, value),
        }
    }

    let decoder = Arc::new(MediaCodec::from_decoder_type(mime).ok_or_else(enone!())?);
    decoder
        .configure(
            &format,
            &surface.native_window(),
            MediaCodecDirection::Decoder,
        )
        .map_err(err!())?;
    decoder.start().map_err(err!())?;

    Ok((
        VideoDecoderEnqueuer {
            inner: Arc::clone(&decoder),
        },
        VideoDecoderDequeuer {
            inner: Arc::clone(&decoder),
            surface,
        },
    ))
}
