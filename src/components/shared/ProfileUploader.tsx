import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";

import { convertFileToUrl } from "@/lib/utils";

type ProfileUploaderProps = {
  fieldChange: (files: File[]) => void;
  mediaUrl?: string;
};

const ProfileUploader = ({ fieldChange, mediaUrl }: ProfileUploaderProps) => {
  const [previewUrl, setPreviewUrl] = useState<string>();
  const fileUrl = previewUrl ?? mediaUrl;

  useEffect(() => {
    if (previewUrl) return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const onDropAccepted = useCallback(
    (acceptedFiles: File[]) => {
      fieldChange(acceptedFiles);
      setPreviewUrl(convertFileToUrl(acceptedFiles[0]));
    },
    [fieldChange]
  );

  const { getRootProps, getInputProps, fileRejections } = useDropzone({
    onDropAccepted,
    multiple: false,
    minSize: 1,
    accept: {
      "image/*": [".png", ".jpeg", ".jpg"],
    },
  });

  return (
    <div {...getRootProps()}>
      <input {...getInputProps()} className="cursor-pointer" />

      <div className="cursor-pointer flex-center gap-4">
        <img
          src={fileUrl || "/assets/icons/profile-placeholder.svg"}
          alt="image"
          className="h-24 w-24 rounded-full object-cover object-top"
        />
        <p className="text-primary-500 small-regular md:base-semibold">
          Change profile photo
        </p>
      </div>
      {fileRejections.length > 0 && (
        <p role="alert" className="small-regular mt-2 text-red-400">
          Choose one image file that is not empty.
        </p>
      )}
    </div>
  );
};

export default ProfileUploader;
